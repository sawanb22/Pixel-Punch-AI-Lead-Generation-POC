// Quick test: call the Hermes health check from Node.js fetch just like the dashboard does
const r = await fetch('http://127.0.0.1:8642/v1/models', {
  headers: {
    Accept: 'application/json',
    Authorization: 'Bearer qhbmv2kczeywp164ngt57xa38olsjrdu',
  },
});
console.log('status:', r.status);
console.log('ok:', r.ok);
const text = await r.text();
console.log('body:', text);
