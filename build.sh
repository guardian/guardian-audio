#!/usr/bin/env bash

rm -rf function-audio-generator/build
# cp riff-raff.yaml target/package/riff-raff.yaml
# cp cfn.yaml target/package/cfn/cfn.yaml

rm -rf target
mkdir -p target/packages/function-audio-generator

PROJECT="mobile:guardian-audio"
BUILD_START_DATE=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")

cat > target/build.json << EOF
{
   "projectName":"$PROJECT",
   "buildNumber":"$BUILD_NUMBER",
   "startTime":"$BUILD_START_DATE",
   "revision":"$BUILD_VCS_NUMBER",
   "vcsURL":"git@github.com:guardian/guardian-audio.git",
   "branch":"$BRANCH_NAME"
}
EOF

export PACKAGE_DIRECTORY=build

cd function-audio-generator
npm install
npm run package
cd ..
cp function-audio-generator/build/* target/packages/function-audio-generator/function-audio-generator.zip

# cp cloudformation/discussion-notifications.yaml target/cfn/cfn.yaml

aws s3 cp --acl bucket-owner-full-control --region=eu-west-1 --recursive target/packages s3://riffraff-artifact/$PROJECT/$BUILD_NUMBER
aws s3 cp --acl bucket-owner-full-control --region=eu-west-1 target/build.json s3://riffraff-builds/$PROJECT/$BUILD_NUMBER/build.json