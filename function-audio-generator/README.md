# function-audio-generator

This is a aws lambda function fetches the latest articles from capi on a regular interval and initiate audio generation for those articles. It goes through each and every article and parse the article body and sanitize it before it initiate audio generation.

Once it make an audio generation request it drop an entry to DynamoDB to keep track of audio are being generated. This database entry is very important for management perspective (i.e. avoid generating duplicate audio etc) which is used by other lamdas in this project.
