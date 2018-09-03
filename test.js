'use strict'

process.env.DEBUG = '*'

const Agent = require('./index')
const proc = {
  axm_actions: [{action_name: 'test', action_type: 'pm2'}]
}
const agent = new Agent({ // eslint-disable-line
  publicKey: 'zftc3kf0ehy12bo',
  secretKey: 'ptcsyi1n6chf9qs',
  appName: 'agent-node'
}, proc, (err, transport) => {
  if (err) return console.error(err)
  // Add some custom actions
  setTimeout(_ => proc.axm_actions.push({action_name: 'lol', action_type: 'pm2'}), 10000)
  // Listen
  let listener = transport.listen('trigger:pm2:action', payload => console.log(payload))
  // Stop listening
  setTimeout(_ => transport.unlisten('trigger:pm2:action', listener))
  // Send packet
  transport.send('exception', {key: 'value'})
  return console.log('done.')
})
