'use strict'

// const request = require('request-promise')
// const fetch = require('node-fetch')
// import fetch from 'node-fetch';
const tiny = require('tiny-json-http')
const sanitizeHtml = require('sanitize-html')
const ssmlValidator = require('ssml-validator')

const CAPI_FIELDS = 'headline,body'
const CAPI_PAGE_SIZE = 2
const CAPI_URL = `https://content.guardianapis.com/search?show-fields=${CAPI_FIELDS}&page-size=${CAPI_PAGE_SIZE}&api-key=`

const PUBLISHER = 'The Guardian'
const LIVE_BLOG_INTRO = "This article is based on a live event, please go to the article page to get up to date information";
const GALLERY_INTO = 'This is a gallery article, you will enjoy more by looking at the amazing photos than listening it. Thank you.'
const VIDEO_INTRO = 'This is a video article. It will be little creepy to explain what is going on in the video. Please watch it. Thank you.'
const AUDIO_INTRO = 'This is a podcast article. I am not cleaver enough to defeat human voice. Please listen to the podcast. Thank you.'
const INTERACTIVE_INTRO = "This is an interactive article and it is better in seeing than listening. Thank you.";

const AUDIO_PAUSE = '<break strength="x-strong" />'
const AUDIO_PAUSE_1S = '<break time="1s" />'
const REGEX_RELATED_CONTENT = /<span>(\s?)Related:(\s?)<\/span>(<a href=)(.+?)(<\/a>)/gm;
const REGEX_VIDEO_EMBED = /(__VIDEO_EMBED_)(.+?)(__)/gm
const REGEX_PARA_START = /<p>/gm
const REGEX_PARA_END = /<\/p>/gm

const aws = require('aws-sdk')
const { dbhandler } = require('./database-ops')
const polly = new aws.Polly({signatureVersion: 'v4', region: 'eu-west-1'})
const dbClient = new aws.DynamoDB.DocumentClient({region: 'eu-west-1'});
const ssm = new aws.SSM({region: 'eu-west-1'})

const ENV = 'CODE' //TODO make it dynamic
const DB_TABLE_NAME = 'guardian-audio-' + ENV
const PARAM_PATH = '/mobile/guardian-audio/' + ENV
const KEY_CAPI_KEY = PARAM_PATH + '/capi.key'
const BUCKET_NAME = 'mobile-guardian-audio'
const BUCKET_OUTPUT_PREFIX = 'raw/' + ENV + '/'
const SNS_TOPIC = 'arn:aws:sns:eu-west-1:201359054765:mobile-guardian-audio-' + ENV
var paramater_store = null


exports.handler = async (event, context, callback) => {
    console.log('starting polly ops', event)

    if(typeof event == 'object' && event.hasOwnProperty('Records')) {        
        console.log('SNS msg found, type, starting DB operations')
        dbhandler(event, context, callback)
        return
    }

    try {
        var success = await fetchParameterStore()
        if(success) {
            let capi_key = getParam(KEY_CAPI_KEY)
            let capiUrl = CAPI_URL + capi_key
            await generate(capiUrl)
            callback(null, 'success')
        }
        else {
            console.log('Function failed to execute due to authentication error')
        }
    } catch(e) {
        console.error('Something went wrong')
        console.error(e)
        callback(e)
    }
    
    // TEST
    // const item = await getTestItem()
    // triggerItemAudioGeneration(item)
    // console.log(item)
    // TEST end
}

async function generate(url) {
    console.log('Retrieving items from CAPI.')
    const response = await tiny.get({url})
    const data = response.body;
    console.log('CAPI items fetched')

    for(const item of data.response.results) {
        const audioExist = await audioAlreadyGenerated(item.id)
        if(!audioExist) {
            triggerItemAudioGeneration(item)
        }
        else {
            console.log('Audio is already generated for: ' + item.id)
        }
    }
}

function triggerItemAudioGeneration(item) {
    const headline = getHeadlineText(item.fields.headline)
    const body = getBody(item)
    const fullText = wrapInSSML(`${headline} ${AUDIO_PAUSE_1S} ${body}`)
    const ssmlFriendlyText = ssmlValidator.correct(fullText)
    
    var params = {
        OutputFormat: 'mp3',
        OutputS3BucketName: BUCKET_NAME,
        Text: ssmlFriendlyText,
        VoiceId: 'Amy',
        LanguageCode: 'en-GB',
        LexiconNames: [],
        OutputS3KeyPrefix: BUCKET_OUTPUT_PREFIX,
        SnsTopicArn: SNS_TOPIC,
        TextType: 'ssml',
        Engine: 'neural'
    };

    polly.startSpeechSynthesisTask(params, (err, data) => {
        if(err) console.error(err)
        else {
            console.log('Audio is being generated for item:', item.id)
            saveAudioMeta(item.id, data)
        }
    })
}

function saveAudioMeta(itemId, data) {
    var param = {
        TableName: DB_TABLE_NAME,
        Item: {
            'task_id': data.SynthesisTask.TaskId,
            'raw_audio_url': data.SynthesisTask.OutputUri,
            'status': data.SynthesisTask.TaskStatus,
            'item_id': itemId,
            'clean_audio_url': 'not-set',
            'task_start_time': Date.now()
        }
    }

    dbClient.put(param, (err, data) => {
        if(err) console.error(err)
        else console.log('item added to dynamo db')
    })
}

function getHeadlineText(articleTitle) {    
    return `${articleTitle} ${AUDIO_PAUSE} Published by ${PUBLISHER}`
}

function getBody(item) {
    // TODO for the special cases, rather than generating audio files multiple times, 
    // we can just point to the existing one  
    if(item.type == 'liveblog') {
        return LIVE_BLOG_INTRO
    }

    if(item.type == 'gallery' || item.type == 'picture') {
        return GALLERY_INTO
    }

    if(item.type == 'video') {
        return VIDEO_INTRO
    }

    if(item.type == 'audio') {
        return AUDIO_INTRO
    }

    if(item.type == 'crossword') {
        return 'This is a crossword.'
    }

    if(item.type == 'interactive') {
        return INTERACTIVE_INTRO
    }

    // remove all related content links    
    var body = item.fields.body.replace(REGEX_RELATED_CONTENT, '')
    // remove all video embeds    
    body = body.replace(REGEX_VIDEO_EMBED, '')
    // remove all html tags except P tag, Polly can handle P tag. Also remove contents
    // of FIGURE tag along with others specified in 'nonTextTags' 
    body = sanitizeHtml(body, {
        allowedTags: ['p'],
        allowedAttributes: {},
        nonTextTags: [ 'style', 'script', 'textarea', 'figure' ]
    })

    return body
}

async function audioAlreadyGenerated(itemId) {
    var param = {
        TableName: DB_TABLE_NAME,
        IndexName: 'item_id-index',
        KeyConditionExpression: "item_id = :id",
        ExpressionAttributeValues: {
            ":id": itemId
        }
    }

    var response = await dbClient.query(param).promise()
    return response.Items.length > 0
}

function wrapInSSML(text) {
    return `<speak> ${wrapInBreaths(text)} </speak>`
}

// this adds artificial breaths at certain intervals
function wrapInBreaths(text) {    
    // amazon:auto-breaths is not available with Neural engine, use it only for Standard engine
    // return `<amazon:auto-breaths volume="x-soft"> ${text} </amazon:auto-breaths>`
    return text
}

async function fetchParameterStore() {
    var param = {
        Path: PARAM_PATH,
        WithDecryption: true
    };

    try{
        let data = await ssm.getParametersByPath(param).promise()
        if(data != null) {
            paramater_store = data.Parameters
            console.log('Paramater retrieved successfully')
            return true
        }
    } catch(e) {
        console.error(e)
    }

    console.log('Failed to retried parameters')
    return false
}

function getParam(paramName) {
    var obj = paramater_store.find(obj => obj.Name==paramName)
    return obj.Value
}

async function getTestItem() {
    const itemId = 'business/2018/dec/07/o2-services-restored-after-millions-hit-by-data-outage'
    const url = `https://content.guardianapis.com/${itemId}?&api-key=${CAPI_API_KEY}&&show-fields=headline,body`
    const item = await request.get({uri: url, json: true})
    return item.response.content
}