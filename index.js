'use strict'

const debug = require('debug')('agent:main')
const http = require('./src/utils/http')
const cst = require('./constants')
const meta = require('./src/utils/meta')
const Transport = require('./src/transport')

module.exports = class Agent {
  /**
   * Init new agent
   * @param {Object} config Configuration
   * @param {String} config.publicKey
   * @param {String} config.secretKey
   * @param {String} config.appName
   * @param {Object} process Process to send
   * @param {Function} cb Invoked with <err, agent>
   */
  constructor (config, proc, cb) {
    debug(`New agent constructed with: [public: ${config.publicKey}, secret: ${config.secretKey}, app: ${config.appName}]`)
    // Valid config
    if (!config ||
      typeof config.publicKey !== 'string' ||
      typeof config.secretKey !== 'string' ||
      typeof config.appName !== 'string' ||
      typeof proc !== 'object') {
      return cb(new Error('You need to provide a valid configuration and process!'))
    }

    // Trying to check infos
    this.checkCredentials(config, (err, endpoints) => {
      if (err) return cb(err)

      // Connect to websocket
      this.transport = new Transport(endpoints.ws, {
        'X-KM-PUBLIC': config.publicKey,
        'X-KM-SECRET': config.secretKey,
        'X-KM-SERVER': config.appName,
        'X-PM2-VERSION': cst.PM2_VERSION,
        'X-PROTOCOL-VERSION': cst.PROTOCOL_VERSION
      })
      return this.transport.connect((err) => {
        if (err) return cb(err)

        // Store config
        this.config = config
        this.config.endpoint = endpoints.ws
        this.config.internalIp = meta.computeInternalIp()
        proc.unique_id = this.generateUniqueId()
        this.process = proc

        // Start sending status
        this.statusInterval = setInterval(this.sendStatus.bind(this), 1 * 1000) // each second

        return cb(null, this)
      })
    })
  }

  /**
   * Generate an unique ID
   */
  generateUniqueId () {
    var s = []
    var hexDigits = '0123456789abcdef'
    for (var i = 0; i < 36; i++) {
      s[i] = hexDigits.substr(Math.floor(Math.random() * 0x10), 1)
    }
    s[14] = '4'
    s[19] = hexDigits.substr((s[19] & 0x3) | 0x8, 1)
    s[8] = s[13] = s[18] = s[23] = '-'
    return s.join('')
  }

  /**
   * Used to generate valid a process
   * @param {Object} process
   * @return {Object} process Valid process with default value
   */
  generateProcess (proc) {
    if (!proc.createdAt) proc.createdAt = new Date().getTime()
    return {
      pid: process.pid,
      name: this.config.appName,
      interpreter: proc.interpreter || 'node',
      restart_time: 0,
      created_at: proc.createdAt,
      exec_mode: 'fork_mode',
      watching: false,
      pm_uptime: process.uptime(),
      status: 'online',
      pm_id: 0,
      unique_id: proc.unique_id,

      cpu: meta.getCpuUsage(),
      memory: meta.getMemoryUsage(),

      versioning: proc.versioning || null,

      node_env: process.NODE_ENV || null,

      axm_actions: proc.axm_actions || [],
      axm_monitor: proc.axm_monitor || {},
      axm_options: proc.axm_options || {},
      axm_dynamic: proc.dynamic || {}
    }
  }

  /**
   * Check credentials with API
   * @param {Object} config Configuration
   * @param {String} config.publicKey
   * @param {String} config.secretKey
   * @param {String} config.appName
   * @param {Function} cb Invoked with <err, endpoints>
   */
  checkCredentials (config, cb) {
    http.open({
      url: cst.ROOT_URL + '/api/node/verifyPM2',
      method: 'POST',
      data: {
        public_id: config.publicKey,
        private_id: config.secretKey,
        data: meta(config.publicKey, config.appName)
      }
    }, (err, data) => {
      if (err) return cb(err)
      if (data.disabled === true || data.pending === true) return cb(new Error('Interactor disabled.'))
      if (data.active === false) return cb(new Error('Interactor not active.'))
      if (!data.endpoints) return cb(new Error(`Endpoints field not present (${JSON.stringify(data)}).`))
      return cb(null, data.endpoints)
    })
  }

  /**
   * Send status
   */
  async sendStatus () {
    return this.transport.send({
      channel: 'status',
      payload: {
        data: {
          process: [this.generateProcess(this.process)],
          server: meta.getServerMeta()
        },
        server_name: this.config.appName,
        internal_ip: this.config.internalIp,
        rev_con: true
      }
    })
  }
}
