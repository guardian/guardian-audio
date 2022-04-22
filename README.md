# guardian-audio
This repo contains code that can generate audio version of the Guardian articles using Amazon Polly. The Amazon Polly generates audio in mp3 format and produce more human like voice using AI based text-to-speech technology.

# How to Run:
Install node (that also install npm)
run 'node-lambda run'

To Debug in VS Code:
open debug.js and use 'Start Debugging' from `Run' menu

# How does it work
The audio generation happens in a few stages:
1. It fetched content (articles) from the CAPI to generate audio
2. It checks database for each article where audio already generate before
3. If not, then it trigger a audio generation request to Amazon Polly
    - On completion, it save an entry to the database to mark audio has been generated
    - Amazon polly also trigger a messeage to given SNSTopic to other lambda can pick it up and do post audio processing


