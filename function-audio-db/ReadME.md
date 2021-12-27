# function-audio-db

This functions receives a sns notification when an audio generation is completed and
then it do some post process operation, namely:

- copy the audio from 'raw' folder to 'clean' folder and rename the file that matches article id (this is due to lack of support in polly api to provid a output file name in the first place)
- Update the corresponding DB entry with 'completed' status
