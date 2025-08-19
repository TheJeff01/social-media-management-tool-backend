const crypto = require('crypto');

function generateRandomString(length = 128) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return result;
}

function base64URLEncode(str) {
  return str
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

function generateCodeChallenge(verifier) {
  return base64URLEncode(sha256(verifier).toString('base64'));
}

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  generateRandomString,
  generateCodeChallenge,
  generateState,
  base64URLEncode
};