const { IncomingWebhook } = require('@slack/webhook');
const { CloudBuildClient } = require('@google-cloud/cloudbuild');

const url = process.env.SLACK_WEBHOOK_URL;
const webhook = new IncomingWebhook(url);

// subscribeSlack is the main function called by Cloud Functions.
module.exports.subscribeSlack = async (pubSubEvent, context) => {
  const build = await eventToBuild(pubSubEvent.data);

  // Skip if the current status is not in the status list.
  // Add additional statuses to list if you'd like:
  // QUEUED, WORKING, SUCCESS, FAILURE,
  // INTERNAL_ERROR, TIMEOUT, CANCELLED
  const status = ['SUCCESS', 'FAILURE', 'INTERNAL_ERROR', 'TIMEOUT'];
  if (status.indexOf(build.status) === -1) {
    return;
  }

  // Send message to Slack.
  const message = createSlackMessage(build);
  webhook.send(message);
};

// eventToBuild transforms pubsub event message to a build object.
// additionally we are going to lookup build data
const eventToBuild = async (data) => {
  let evt = JSON.parse(Buffer.from(data, 'base64').toString());

  const cb = new CloudBuildClient();
  let build = await cb.getBuild({
    id : evt.id,
    projectId : 'digital-ucdavis-edu'
  });

  build = build[0];
  let resp = {
    artifacts : (build.artifacts || {}).images || [],
    images : build.images || [],
    status: build.status,
    substitutions : build.substitutions,
    logUrl : build.logUrl,
    id : build.id
  }

  return resp;
}

// createSlackMessage creates a message from a build object.
const createSlackMessage = (build) => {
  let substitutions = '';
  if( build.substitutions ) {
    substitutions = [];
    let s = build.substitutions;
    if( s.REPO_NAME ) substitutions.push('Repo: '+s.REPO_NAME);
    if( s.BRANCH_NAME ) substitutions.push('Branch: '+s.BRANCH_NAME);
    if( s.TAG_NAME ) substitutions.push('Tag: '+s.TAG_NAME);
    if( s.SHORT_SHA ) substitutions.push('Sha: '+s.SHORT_SHA);
    substitutions = substitutions.join(', ');
  }

  const message = {
    text: `Build \`${build.id}\`
${substitutions}
Images: ${(build.artifacts || build.images).join(', ')}`,
    mrkdwn: true,
    attachments: [
      {
        title: 'Build logs',
        title_link: build.logUrl,
        fields: [{
          title: 'Status',
          value: build.status
        }]
      }
    ]
  };
  return message;
}