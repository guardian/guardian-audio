'use strict'

const aws = require('aws-sdk')
const s3 = new aws.S3()
const URL = require('url').URL

const ENV = 'CODE' //TODO make it dynamic
const DB_TABLE_NAME = 'guardian-audio-' + ENV
const BUCKET_NAME = 'mobile-guardian-audio'
const dbClient = new aws.DynamoDB.DocumentClient({region: 'eu-west-1'});


exports.dbhandler = async (event, context, callback) => {
    console.log('DATABASE ops is running with ' + JSON.stringify(event))
    var message = JSON.parse(event.Records[0].Sns.Message);
    console.log('im here: 1')
    await doPostAudioCompletion(message, callback)
}

async function doPostAudioCompletion(message, callback) {
    const item = await getItem(message.taskId)
    const cleanAudioUrl = await copyAudioToCleanFolder(message, item)
    if(cleanAudioUrl == null) {
        console.log('Ignoring post clean due to missing db entry')
        return
    }

    // Possible values of 'taskStatus' are: scheduled | inProgress | completed | failed.
    const newStatus = String(message.taskStatus).toLowerCase()
    var param = {
        TableName: DB_TABLE_NAME,
        Key: {
            "item_id": item.item_id 
        },
        UpdateExpression: "set #status_placeholder=:s, clean_audio_url=:u, task_end_time=:t",
        ExpressionAttributeNames: {"#status_placeholder": "status"},
        ExpressionAttributeValues: {
            ":s": newStatus,
            ":u": cleanAudioUrl,
            ":t": Date.now()
        },
        ReturnValues:"UPDATED_NEW"
    }

    console.log('Updating db record...')
    await dbClient.update(param).promise()
}

async function copyAudioToCleanFolder(message, item) {
    if(item == null) {
        console.log('Did not find db item for taskId: ' + message.taskId)
        return null
    }

    const currentAudioFile = message.outputUri.split('s3:/')[1] // remove the schema and take bucket name along file name    
    const newFileName = 'clean/' + ENV + '/' + item.item_id + '.mp3'
    var copyParam = {
        Bucket: BUCKET_NAME,
        Key: newFileName,
        ACL: 'public-read',
        CopySource: currentAudioFile,
        ContentType: 'audio/mpeg',
        MetadataDirective: 'REPLACE'
    }
    console.log('im here: 3')
    var response = await s3.copyObject(copyParam).promise()
    console.log('im here: 4: ' + JSON.stringify(response))
    console.log('Successfully copied audio to clean folder')

    // Now upload a json file with audio url and some metadata
    const publicAudioUrl = new URL(item.raw_audio_url).origin + '/' + BUCKET_NAME + '/clean/' + ENV + '/' + item.item_id + '.mp3'
    console.log('im here: 5')
    const data = {'audioUrl': publicAudioUrl, 'durationInSec': -1} // TODO fix duration
    console.log('im here: 6')
    const param = {
        Bucket: BUCKET_NAME,
        Key: 'clean/' + ENV + '/' + item.item_id + '.json',
        ACL: 'public-read',
        Body: JSON.stringify(data),
        ContentType: 'application/json'
    }
    const result = await s3.putObject(param).promise()
    console.log('im here: 7: ' + JSON.stringify(result))
    console.log('Successfully uploaded json file')

    return publicAudioUrl
}

async function getItem(taskId) {
    var param = {
        TableName: DB_TABLE_NAME,
        IndexName: 'task_id-index',
        KeyConditionExpression: "task_id = :id",
        ExpressionAttributeValues: {
            ":id": taskId
        }
    }

    var response = await dbClient.query(param).promise()
    return response.Items.length > 0 ? response.Items[0] : null
}

