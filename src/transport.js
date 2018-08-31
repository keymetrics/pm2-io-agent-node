'use strict'

const WebSocket = require('ws')
const debug = require('debug')('agent:transport')

module.exports = class WebsocketTransport {
  /**
   * Construct new websocket instance for specific endpoint
   * @param {Object} headers Key-value with upgrade headers
   * @param {String} endpoint Websocket endpoint
   */
  constructor (endpoint, headers) {
    debug(`Init new websocket transport with endpoint: ${endpoint} and headers: [${Object.keys(headers).map(header => `${header}: ${headers[header]}`).join(',')}]`)
    this.endpoint = endpoint
    this.headers = headers
    this.ws = null
    this.pingInterval = null
    this.listeners = {}
  }

  /**
   * Connect to websocket server
   * @param {Function} cb Invoked with <err, ws>
   */
  connect (cb) {
    debug('Connect transporter to websocket server')
    this.ws = new WebSocket(this.endpoint, {
      perMessageDeflate: false,
      handshakeTimeout: 5 * 1000, // 5 seconds
      headers: this.headers
    })

    const onError = (err) => {
      this.ws.removeAllListeners()
      return cb(err)
    }
    this.ws.once('error', onError)
    this.ws.once('open', _ => {
      debug('Websocket connected')
      this.ws.removeListener('error', onError)
      this.ws.on('close', this.onClose.bind(this))
      // We don't handle errors (DNS issues...), ping will close/reopen if any error is found
      this.ws.on('error', err => debug(`Got an error with websocket connection: ${err.message}`))
      this.pingInterval = setInterval(this.ping.bind(this), 30 * 1000) // 30 seconds
      return cb(null, this.ws)
    })
    this.ws.on('ping', _ => {
      debug('Received ping! Pong sended!')
      this.ws.pong()
    })
    this.ws.on('message', this.onMessage.bind(this))
  }

  /**
   * When websocket connection is closed, try to reconnect
   */
  onClose () {
    debug(`Websocket connection is closed, try to reconnect`)
    this.ws.terminate()
    this.ws.removeAllListeners()
    return this.connect(err => debug(err ? `Got an error on websocket connection: ${err.message}` : 'Websocket connection successfuly reconnected'))
  }

  /**
   * Send to listeners
   * @param {String} rawData
   */
  onMessage (rawData) {
    let data = null
    try {
      data = JSON.parse(rawData)
    } catch (e) {
      return debug(`Get non-JSON data from websocket server: ${rawData}`)
    }
    if (!data.channel || !data.payload) return debug(`Get bad message from websocket server: ${rawData}`)
    if (!this.listeners[data.channel]) return false
    return this.listeners[data.channel].forEach(fn => fn(data.payload))
  }

  /**
   * Try to ping server, if we get no response, disconnect and try to reconnect
   */
  ping () {
    const noResponse = _ => {
      clearTimeout(timeout)
      debug('We can\'t get any response to ping from websocket server, trying to reconnect')
      this.ws.terminate()
      return this.connect(err => debug(err ? `Got an error on websocket connection: ${err.message}` : 'Websocket connection successfuly reconnected'))
    }
    const timeout = setTimeout(noResponse.bind(this), 5 * 1000) // 5 seconds timeout

    this.ws.ping((err) => {
      if (err) return noResponse()
      return debug('Successfuly sended a ping!')
    })
    this.ws.on('pong', _ => {
      clearTimeout(timeout)
      return debug('Websocket server has replied to ping!')
    })
  }

  /**
   * Send data to websocket server
   * @param {Object} packet Packet to send (send with JSON)
   */
  send (packet) {
    if (!this.isConnected()) return false
    if (!packet.channel || !packet.payload) return false
    this.ws.send(JSON.stringify(packet))
    return true
  }

  /**
   * Listen messages from websocket server
   * @param {String} event Channel to listen
   * @param {Function} cb To invoke
   */
  listen (event, cb) {
    if (!this.listeners[event]) this.listeners[event] = []
    return this.listeners[event].push(cb)
  }

  /**
   * Stop listening specific event
   * @param {String} event Channel to stop listening
   * @param {Function} [cb]
   */
  unlisten (event, cb) {
    if (!this.listeners[event]) return null
    if (!cb) {
      this.listeners[event] = [] // Stop listening this event
      return []
    }
    let indexToRemove = -1
    this.listeners[event].forEach((fn, index) => {
      if (fn === cb) indexToRemove = index
    })
    return this.listeners.splice(indexToRemove, 1)
  }

  /**
   * Disconnect from websocket server
   */
  disconnect () {
    debug('Disconnect from websocket server')
    return this.ws.close()
  }

  /**
   * Return if websocket is connected or not
   */
  isConnected () {
    return this.ws && this.ws.readyState < 2 // Connected or connecting
  }
}
