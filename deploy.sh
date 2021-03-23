cd slack

PROJECT_ID=digital-ucdavis-edu
SECRET=google-cloud-build-slack-webhook

gcloud config set project $PROJECT_ID
SLACK_WEBHOOK_URL=$(gcloud secrets versions access latest --secret=${SECRET})

gcloud functions deploy subscribeSlack \
  --trigger-topic cloud-builds \
  --runtime nodejs12 \
  --set-env-vars "SLACK_WEBHOOK_URL=${SLACK_WEBHOOK_URL}"