'use strict'

const aws = require('aws-sdk')
const s3 = new aws.S3()
const URL = require('url').URL

const DB_TABLE_NAME = 'guardian-audio'
const BUCKET_NAME = 'mobile-guardian-audio'
const dbClient = new aws.DynamoDB.DocumentClient({apiVersion: '2012-10-08', region: 'eu-west-1'})


exports.dbhandler = async (event, context, callback) => {
    console.log('DATABASE ops is running with ' + JSON.stringify(event))
    var message = JSON.parse(event.Records[0].Sns.Message);
    doPostAudioCompletion(message, callback)
}

async function doPostAudioCompletion(message, callback) {
    const cleanAudioUrl = await copyAudioToCleanFolder(message)
    if(cleanAudioUrl == null) {
        console.log('Ignoring post clean due to missing db entry')
        return
    }

    // For simpler DB query we are storing just two possible values in DynamoDB
    // Actual possible values are: scheduled | inProgress | completed | failed.
    const newStatus = String(message.taskStatus).toLowerCase()
    var param = {
        TableName: DB_TABLE_NAME,
        Key: {
            "task_id": message.taskId 
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
    
    dbClient.update(param, (err, data) => {
        if(err) console.error(err)
        else {
            console.log('Item updated successfully')
            callback(null, "Success")
        }
    })
}

async function copyAudioToCleanFolder(message) {
    const item = await getItem(message.taskId)
    if(item == null) {
        console.log('Did not find db item for taskId: ' + message.taskId)
        return null
    }

    const currentAudioFile = message.outputUri.split('s3:/')[1] // remove the schema and take bucket name along file name    
    const newFileName = 'clean/' + item.item_id + '.mp3'
    var copyParam = {
        Bucket: BUCKET_NAME,
        Key: newFileName,
        CopySource: currentAudioFile,
        ACL: 'public-read',
        ContentType: 'audio/mpeg',
        MetadataDirective: 'REPLACE'
    }
    var response = await s3.copyObject(copyParam).promise()
    console.log('Successfully copied audio to clean folder')

    // Now upload a json file with audio url and some metadata
    const publicAudioUrl = new URL(item.raw_audio_url).origin + '/' + BUCKET_NAME + '/clean/' + item.item_id + '.mp3'
    const data = {'audioUrl': publicAudioUrl, 'durationInSec': -1} // TODO fix duration
    const param = {
        Bucket: BUCKET_NAME,
        Key: 'clean/' + item.item_id + '.json',
        ACL: 'public-read',
        Body: JSON.stringify(data),
        ContentType: 'application/json'
    }
    const result = await s3.putObject(param).promise()
    console.log('Successfully uploaded json file')

    return publicAudioUrl
}

async function getItem(taskId) {
    var param = {
        TableName: DB_TABLE_NAME,
        Key: {
            "task_id": taskId
        }
    }

    var response = await dbClient.get(param).promise()
    return response.Item ? response.Item : null
}

