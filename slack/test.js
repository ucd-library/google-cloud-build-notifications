const {CloudBuildClient} = require('@google-cloud/cloudbuild');
const cb = new CloudBuildClient({
  projectId : 'digital-ucdavis-edu',
  keyFilename : './webapp-service-account.json'
});

(async function() {
  let build = await cb.getBuild({
    id : 'c586501e-a90a-41c1-b805-01720dee372d',
    projectId : 'digital-ucdavis-edu'
  })
  console.log(JSON.stringify(build, '  ', '  '));
})()

function getResponseInfo(build) {
  build = build[0];

  let build = {
    images : (build.artifacts || {}).images || [],
    status: build.status,
    substitutions : build.substitutions,
    logUrl : build.logUrl,
    id : build.id
  }

}