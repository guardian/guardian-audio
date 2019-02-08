'use strict'

const aws = require('aws-sdk')
const dbClient = new aws.DynamoDB.DocumentClient({apiVersion: '2012-10-08', region: 'eu-west-1'})

const DB_TABLE_NAME = 'guardian-audio'

// This function's responsibility is to clean up any DB entry for which polly could not generate the mp3
// file or polly did generate the mp3 but 'audio db' function did not triggered by sns to complete the post 
// audio completion task. 

exports.handler = (event, context, callback) => {
    getDbEntries()
}

async function getDbEntries(params) {

    // find all the db entries with non completed status (it will be 'scheduled')
    var param = {
        TableName: DB_TABLE_NAME,
        IndexName: 'status-index',
        ExpressionAttributeNames: {"#task_status": "status"},
        KeyConditionExpression: "#task_status = :s",
        ExpressionAttributeValues: {
            ":s": 'scheduled',
        }
    }

    const result = await dbClient.query(param).promise()
    console.log('Total items can be deleted is: ' + result.Count)

    // now delete all the entried from the DB, generated audios are in 'raw' folder
    // which will be deleted by s3 expiration policy
    for(const item of result.Items) {
        const param = {
            TableName: DB_TABLE_NAME,
            Key: {
                'task_id': item.task_id
            }
        }

        await dbClient.delete(param).promise().then(() => {
            console.log('Item deleted')
        }).catch(err => {
            console.error(err)
        })
    }

    console.log('Cleanup completed')
}