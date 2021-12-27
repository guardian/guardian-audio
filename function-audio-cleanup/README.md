# function-audio-cleanup

This function's responsibility is to clean up any DB entry for which polly could not generate the mp3 file or polly did generate the mp3 but 'function-audio-db' lambda did not triggered by sns to complete the post audio completion task.
