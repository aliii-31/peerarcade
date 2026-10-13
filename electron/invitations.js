const { randomBytes, createHash } = require('node:crypto')

function createInvitation() {
  return `pa1-${randomBytes(32).toString('hex')}`
}

function parseInvitation(invitation) {
  if (typeof invitation !== 'string' || !/^pa1-[a-f0-9]{64}$/.test(invitation)) {
    throw new Error('Invalid invitation. Expected pa1- followed by 64 lowercase hexadecimal characters.')
  }
  const secret = invitation.slice(4)
  const topic = createHash('sha256').update(`peerarcade-room-v1:${secret}`).digest('hex')
  return { secret, topic }
}

module.exports = { createInvitation, parseInvitation }
