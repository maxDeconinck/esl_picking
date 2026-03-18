import axios from 'axios'
import fs from 'fs/promises'
import Logger from './Logger.js'
import Device from "../models/Device.js";

const TOKEN_FILE = new URL('../.minew_token.json', import.meta.url)

class Minew {
  constructor() {
    this.storeId = process.env.MINEW_STORE_ID
    this.baseUrl = process.env.MINEW_BASE_URL
    this.clientId = process.env.MINEW_CLIENT_ID
    this.clientSecret = process.env.MINEW_CLIENT_SECRET
    this.token = null
    this.expiresAt = 0
    this.logger = Logger || console
  }

  async loadTokenFromFile() {
    try {
      const raw = await fs.readFile(TOKEN_FILE, 'utf8')
      const obj = JSON.parse(raw)
      if (obj && obj.token && obj.expiresAt) {
        this.token = obj.token
        this.expiresAt = obj.expiresAt
        return true
      }
    } catch (err) {
      // ignore if file not found
    }
    return false
  }

  async saveTokenToFile() {
    try {
      const data = JSON.stringify({ token: this.token, expiresAt: this.expiresAt })
      await fs.writeFile(TOKEN_FILE, data, 'utf8')
    } catch (err) {
      this.logger.error('MinewService: cannot save token file', err)
    }
  }

  async authenticate() {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('MINEW_CLIENT_ID and MINEW_CLIENT_SECRET must be set')
    }

    const url = `${this.baseUrl.replace(/\/$/, '')}/apis/action/login`
    try {
      const payload = {
        username: this.clientId,
        password: this.clientSecret
      }

      const res = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      })

      const data = res.data.data
      if (!data || !data.token) throw new Error('invalid auth response')

      this.token = data.token
      this.expiresAt = Date.now() + 24 * 60 * 60 * 1000 // Dans 24h
      await this.saveTokenToFile()
      this.logger.info('MinewService: authenticated, token acquired')
      return this.token
    } catch (err) {
      this.logger.error('MinewService: authenticate error', err?.response?.data || err.message || err)
      throw err
    }
  }

  async getToken() {
    if (this.token && Date.now() < this.expiresAt - 5000) return this.token
    const loaded = await this.loadTokenFromFile()
    if (loaded && this.token && Date.now() < this.expiresAt - 5000) return this.token
    return this.authenticate()
  }

  // blinkTag: envoie une commande pour faire clignoter une étiquette
  // Note: adaptez `commandPath` et le corps selon la doc Minew fournie.
  async blinkTag(tagId, { color = '0', total = 10, period = '800', interval = '200', brightness = '100' } = {}) {
    if (!tagId) throw new Error('tagId is required')
    // Si color est un nom de couleur, on peut le convertir en code hexadécimal ou en code Minew selon la doc.
    if(typeof color === 'string') { color = this.colorNameToCode(color)    }
    const token = await this.getToken()
    let url = `${this.baseUrl.replace(/\/$/, '')}/apis/esl/label/led`

    url += `?storeId=${encodeURIComponent(this.storeId)}&color=${encodeURIComponent(color)}&mac=${encodeURIComponent(tagId)}&interval=${encodeURIComponent(interval)}&period=${encodeURIComponent(period)}&brightness=${encodeURIComponent(brightness)}&total=${encodeURIComponent(total)}`

    try {
      const res = await axios.get(url, {
        headers: { Token: token },
        timeout: 10000
      })
      this.logger.info(`MinewService: blinkTag command sent to tag ${tagId}`, { response: res.data })
      return res.data
    } catch (err) {
      this.logger.error(`MinewService: error sending blinkTag command to tag ${tagId}`, err?.response?.data || err.message || err)

      // On retry la commande une seconde fois
      try {
        const res = await axios.get(url, {
          headers: { Token: token },
          timeout: 10000
        })
        this.logger.info(`MinewService: blinkTag command retry sent to tag ${tagId}`, { response: res.data })
        return res.data
      } catch (err) {
        this.logger.error(`MinewService: error on retry sending blinkTag command to tag ${tagId}`, err?.response?.data || err.message || err)
      }
      throw err
    }
  }

  async blinkTagByPosition(position, options = {}) {
    if (!position) throw new Error('position is required')

    const tag = await Device.findByEmplacement(position)
    if (tag === undefined || tag === null) {
      this.logger.warn(`MinewService: no tag found for position ${position}`)
      return null
    } else if (!tag.mac) {
      this.logger.warn(`MinewService: tag found for position ${position} has no MAC address`, tag)
      return null
    } else {
      return this.blinkTag(tag.mac, options)
    }
  }

  async addGoodsToStore(data) {
    const token = await this.getToken()
    let url = `${this.baseUrl.replace(/\/$/, '')}/apis/esl/goods/addToStore`
    let payload = {
      id: data.productId,
      storeId: this.storeId,
      PartNo: data.lot,
      name: data.name,
      quantity: data.quantity,
      specification: data.emplacement,
      stock: data.stock,
      ref: data.ref,
      qrcode: data.qrcode
    }
    try {
      // Remove DATA before insert
      const resDelete = await axios.post(`${this.baseUrl.replace(/\/$/, '')}/apis/esl/goods/batchDelete`, {
        storeId: this.storeId,
        idArray: [data.productId]
      }, {
        headers: { Token: token, 'Content-Type': 'application/json' },
        timeout: 10000
      })
      this.logger.info('MinewService: deleteGoodsFromStore command sent', { response: resDelete.data })

      // Add new DATA
      const res = await axios.post(url, payload, {
        headers: { Token: token, 'Content-Type': 'application/json' },
        timeout: 10000
      })
      this.logger.info('MinewService: addGoodsToStore command sent', { response: res.data })
      return res.data
    } catch (err) {
      this.logger.error('MinewService: error sending addGoodsToStore command', err?.response?.data || err.message || err)
      // On retry une seconde fois
      try {
        const res = await axios.post(url, payload, {
          headers: { Token: token, 'Content-Type': 'application/json' },
          timeout: 10000
        })
        this.logger.info('MinewService: addGoodsToStore command retry sent', { response: res.data })
        return res.data
      } catch (err) {
        this.logger.error('MinewService: error on retry sending addGoodsToStore command', err?.response?.data || err.message || err)
      }
      throw err
    }
  }

  async refreshGoodsInStore(data) {
    const token = await this.getToken()
    let url = `${this.baseUrl.replace(/\/$/, '')}/apis/esl/goods/updateToStore`
    let payload = {
      id: data.productId,
      storeId: this.storeId,
      PartNo: data.lot,
      name: data.name,
      quantity: data.quantity,
      specification: data.emplacement,
      stock: data.stock,
      ref: data.ref,
      qrcode: data.qrcode,
      mode : data.mode || "Disponible"
    }
    try {
      const res = await axios.post(url, payload, {
        headers: { Token: token, 'Content-Type': 'application/json' },
        timeout: 10000
      })
      this.logger.info('MinewService: refreshGoodsInStore command sent', { response: res.data })
      return res.data
    } catch (err) {
      this.logger.error('MinewService: error sending refreshGoodsInStore command', err?.response?.data || err.message || err)
      // On retry une seconde fois
      try {
        const res = await axios.post(url, payload, {
          headers: { Token: token, 'Content-Type': 'application/json' },
          timeout: 10000
        })
        this.logger.info('MinewService: refreshGoodsInStore command retry sent', { response: res.data })
        return res.data
      } catch (err) {
        this.logger.error('MinewService: error on retry sending refreshGoodsInStore command', err?.response?.data || err.message || err)
      }
      throw err
    }
  }

  async changeTagDisplay(tagId, { mode, idData } = {}) {
    if (!tagId) throw new Error('tagId is required')
    const token = await this.getToken()
    let url = `${this.baseUrl.replace(/\/$/, '')}/apis/esl/label/multiScreenBinding`
    let code = '2026214340654272512' // Picking par défaut
    if(mode == "inventory") {
      code = '2026695741933621248'
    } else if (mode == "picking") {
      code = '2026214340654272512'
    }

    let payload = {
      brushDataTemplateList:
        [
          {
            demoId: code,
            goodsId: idData,
            side: "A"
          }
        ],
      labelMac: tagId,
      storeId: this.storeId
    }

    try {
      const res = await axios.post(url, payload,{
        headers: { Token: token },
        timeout: 10000
      })
      this.logger.info(`MinewService: changeTagDisplay command sent to tag ${tagId}`, { response: res.data })
      return res.data
    } catch (err) {
      this.logger.error(`MinewService: error sending changeTagDisplay command to tag ${tagId}`, err?.response?.data || err.message || err)
      // On retry une seconde fois
      try {         
        const res = await axios.post(url, payload,{
          headers: { Token: token },
          timeout: 10000
        })
        this.logger.info(`MinewService: changeTagDisplay command retry sent to tag ${tagId}`, { response: res.data })
        return res.data
      } catch (err) {
        this.logger.error(`MinewService: error on retry sending changeTagDisplay command to tag ${tagId}`, err?.response?.data || err.message || err)
      }
      throw err
    }
  }

  colorNameToCode(name) {
    const colors = {
      blue: '1',
      green: '2',
      red: '3',
      yellow: '4',
      white: '5',
      magenta: '6',
      cyan: '7',
      off: '0'
    }
    return colors[name.toLowerCase()] || name
  }
}

const instance = new Minew()
export default instance
