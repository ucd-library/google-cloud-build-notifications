const { IncomingWebhook } = require('@slack/webhook');
const { CloudBuildClient } = require('@google-cloud/cloudbuild');
const {SecretManagerServiceClient} = require('@google-cloud/secret-manager');
const { Storage } = require('@google-cloud/storage');
const fetch = require('node-fetch');

const url = process.env.SLACK_WEBHOOK_URL;
const webhook = new IncomingWebhook(url);
const secretClient = new SecretManagerServiceClient();
const SECRET_NAME = 'github-os-ci-bot-api-token';

// subscribeSlack is the main function called by Cloud Functions.
module.exports.subscribeSlack = async (pubSubEvent, context) => {
  const build = await eventToBuild(pubSubEvent.data);
  const metadata = await getBuildInformation(build);

  // Skip if the current status is not in the status list.
  // Add additional statuses to list if you'd like:
  // QUEUED, WORKING, SUCCESS, FAILURE,
  // INTERNAL_ERROR, TIMEOUT, CANCELLED
  const status = ['QUEUED', 'WORKING', 'SUCCESS', 'FAILURE', 'INTERNAL_ERROR', 'TIMEOUT'];
  if (status.indexOf(build.status) === -1) {
    return;
  }

  // Send message to Slack.
  const message = createSlackMessage(build, metadata);
  await webhook.send(message);

  if( build.substitutions._GITHUB_EVENT === 'pull_request' && metadata && metadata.APP_VERSION ) {
    let githubSecret = await loadLatestSecret(SECRET_NAME);
    await fetch(`https://api.github.com/repos/${build.substitutions._GITHUB_REPOSITORY}/issues/${build.substitutions._GITHUB_ISSUE_NUMBER}/comments`,{
      method: 'POST',
      headers : {
        'Accept' : 'application/vnd.github.v3+json',
        'Authorization': `token ${githubSecret}`
      },
      body : JSON.stringify({
        body : 'deployed at `'+metadata.APP_VERSION+'`'
      })
    })
  }
};

// see if there is build information stored in GCS
const getBuildInformation = async (build) => {
  let sub = build.substitutions || {};
  try {
    const storage = new Storage();
    let file = storage.bucket(sub._CONFIG_BUCKET).file(`${sub._CONFIG_PROJECT}/${build.id}/config.json`);
    
    if( !(await file.exists())[0] ) {
      console.log('no gcs build config data, ignoring');
      return null; 
    }
    
    let data = (await file.download())[0].toString('utf-8');
    return JSON.parse(data);
  } catch(e) {
    console.error(`failed to download config  file gs://${sub._CONFIG_BUCKET}/${sub._CONFIG_PROJECT}/${build.id}/config.json`, e);
  }
  return null;
}

// eventToBuild transforms pubsub event message to a build object.
// additionally we are going to lookup build data
const eventToBuild = async (data) => {
  let evt = JSON.parse(Buffer.from(data, 'base64').toString());

  const cb = new CloudBuildClient();
  let build = await cb.getBuild({
    name : evt.name,
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

async function loadLatestSecret(name) {
  let resp = await secretClient.accessSecretVersion({
    name: `projects/digital-ucdavis-edu/secrets/${name}/versions/latest`
  });
  return resp[0].payload.data.toString('utf-8');
}

// createSlackMessage creates a message from a build object.
const createSlackMessage = (build, metadata) => {
  let title = '';
  let substitutions = '';
  let imagesText = '';

  if( !build.substitutions ) {
    build.substitutions = {};
  }

  if( metadata ) {
    for( key in metadata ) {
      let value = metadata[key];
      if( !value ) continue;
      build.substitutions[key] = Array.isArray(value) ? value.join(', ') : value
    }
  }

  if( build.substitutions ) {
    if( build.substitutions.REPO_NAME ) {
      title = `\`${build.substitutions.REPO_NAME}\`\n`;
    }

    substitutions = [];

    Object
      .keys(build.substitutions)
      .sort()
      .forEach(key => substitutions.push(key+': '+build.substitutions[key]));
    substitutions = substitutions.join('\n');
  }

  let images = new Set();
  (build.artifacts || []).forEach(item => images.add(item));
  (build.images || []).forEach(item => images.add(item));

  if( images.size ) {
    imagesText = '\nImages: '+([...images].join(', '));
  }

  const message = {
    text: `${title}Build ${build.id} - ${build.status}
${substitutions}${imagesText}`,
    mrkdwn: true,
    attachments: [
      {
        title: 'Build logs',
        title_link: build.logUrl,
        fields: []
      }
    ]
  };
  return message;
}