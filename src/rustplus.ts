'use strict'

import WebSocket from 'ws'
import { EventEmitter } from 'events'
import { AppMessage, AppRequest, AppResponse } from './interfaces/rustplus'

export class RustPlus extends EventEmitter {
  private seq: number = 0
  private seqCallbacks: Function[] = []
  private websocket: WebSocket

  /**
   * @param server The ip address or hostname of the Rust Server
   * @param port The port of the Rust Server (app.port in server.cfg)
   * @param playerId SteamId of the Player
   * @param playerToken Player Token from Server Pairing
   * @param useFacepunchProxy True to use secure websocket via Facepunch's proxy, or false to directly connect to Rust Server
   *
   * Events emitted by the RustPlus class instance
   * - connecting: When we are connecting to the Rust Server.
   * - connected: When we are connected to the Rust Server.
   * - message: When an AppMessage has been received from the Rust Server.
   * - request: When an AppRequest has been sent to the Rust Server.
   * - disconnected: When we are disconnected from the Rust Server.
   * - error: When something goes wrong.
   */
  constructor(
    private readonly server: string,
    private readonly port: string,
    private readonly playerId: string,
    private readonly playerToken: number,
    private readonly useFacepunchProxy = false
  ) {
    super()
  }

  /**
   * This sets everything up and then connects to the Rust Server via WebSocket.
   */
  async connect() {
    this.emit('connecting')
    return new Promise<WebSocket>((resolve) => {
      // connect to websocket
      const address = this.useFacepunchProxy
        ? `wss://companion-rust.facepunch.com/game/${this.server}/${this.port}`
        : `ws://${this.server}:${this.port}`
      this.websocket = new WebSocket(address)

      // fire event when connected
      this.websocket.on('open', () => {
        this.emit('connected')
        resolve(this.websocket)
      })

      // fire event for websocket errors
      this.websocket.on('error', (e) => {
        this.emit('error', e)
      })

      this.websocket.on('close', () => {
        this.emit('disconnected')
      })

      this.websocket.on('message', (data) => {
        const message = AppMessage.fromBinary(data as any)
        console.info(message)
        // check if received message is a response and if we have a callback registered for it
        if (
          message.response &&
          message.response.seq &&
          this.seqCallbacks[message.response.seq]
        ) {
          // get the callback for the response sequence
          var callback = this.seqCallbacks[message.response.seq]

          // call the callback with the response message
          var result = callback(message)

          // remove the callback
          delete this.seqCallbacks[message.response.seq]

          // if callback returns true, don't fire message event
          if (result) {
            return
          }

          this.emit('message', message)
        }
      })
    })
  }

  /**
   * Disconnect from the Rust Server.
   */
  disconnect() {
    if (this.websocket) {
      this.websocket.terminate()
      this.websocket = null
    }
  }

  /**
   * Send a Request to the Rust Server with an optional callback when a Response is received.
   * @param data this should contain valid data for the AppRequest packet in the rustplus.proto schema file
   * @param callback
   */
  private sendRequest(data: any, callback: Function) {
    // increment sequence number
    let currentSeq = ++this.seq
    // save callback if provided
    if (callback) {
      this.seqCallbacks[currentSeq] = callback
    }
    // create protobuf from AppRequest packet
    let request = AppRequest.toBinary({
      seq: currentSeq,
      playerId: this.playerId,
      playerToken: this.playerToken,
      ...data, // merge in provided data for AppRequest
    })

    // send AppRequest packet to rust server
    this.websocket.send(request)
    // fire event when request has been sent, this is useful for logging
    this.emit('request', request)
  }

  /**
   * Send a Request to the Rust Server and return a Promise
   * @param data this should contain valid data for the AppRequest packet defined in the rustplus.proto schema file
   * @param timeoutMilliseconds milliseconds before the promise will be rejected. Defaults to 10 seconds.
   */
  sendRequestAsync(
    data: Omit<AppRequest, 'playerToken' | 'playerId' | 'seq'>,
    timeoutMilliseconds = 10000
  ) {
    return new Promise((resolve, reject) => {
      // reject promise after timeout
      var timeout = setTimeout(() => {
        reject(new Error('Timeout reached while waiting for response'))
      }, timeoutMilliseconds)

      // send request
      this.sendRequest(data, (message) => {
        // cancel timeout
        clearTimeout(timeout)

        if (message.response.error) {
          // reject promise if server returns an AppError for this request
          reject(message.response.error)
        } else {
          // request was successful, resolve with message.response
          resolve(message.response)
        }
      })
    })
  }

  /**
   * Send a Request to the Rust Server and return a Promise
   * @param data this should contain valid data for the AppRequest packet defined in the rustplus.proto schema file
   * @param timeoutMilliseconds milliseconds before the promise will be rejected. Defaults to 10 seconds.
   */
  send<T extends keyof AppResponse>(
    data: Omit<AppRequest, 'playerToken' | 'playerId' | 'seq'>,
    key: T,
    timeoutMilliseconds = 10000
  ) {
    return new Promise<AppResponse[T]>((resolve, reject) => {
      // reject promise after timeout
      const timeout = setTimeout(() => {
        reject(new Error('Timeout reached while waiting for response'))
      }, timeoutMilliseconds)

      // send request
      this.sendRequest(data, (message: AppMessage) => {
        // cancel timeout
        clearTimeout(timeout)

        if (message.response.error) {
          // reject promise if server returns an AppError for this request
          reject(message.response.error)
        } else {
          // request was successful, resolve with message.response
          resolve(message.response[key])
        }
      })
    })
  }

  /**
   * Send a Request to the Rust Server to set the Entity Value.
   * @param entityId the entity id to set the value for
   * @param value the value to set on the entity
   * @param callback
   */
  async setEntityValue(entityId: number, value: boolean) {
    await this.sendRequestAsync({
      entityId: entityId,
      setEntityValue: {
        value: value,
      },
    })
  }

  /**
   * Turn a Smart Switch On
   * @param entityId the entity id of the smart switch to turn on
   * @param callback
   */
  async turnSmartSwitchOn(entityId: number) {
    await this.setEntityValue(entityId, true)
  }

  /**
   * Turn a Smart Switch Off
   * @param entityId the entity id of the smart switch to turn off
   * @param callback
   */
  async turnSmartSwitchOff(entityId: number) {
    await this.setEntityValue(entityId, false)
  }

  /**
   * Send a message to Team Chat
   * @param message the message to send to team chat
   */
  async sendTeamMessage(message: string) {
    await this.sendRequestAsync({
      sendTeamMessage: {
        message: message,
      },
    })
  }

  /**
   * Get info for an Entity
   * @param entityId the id of the entity to get info of
   */
  async getEntityInfo(entityId: number) {
    return await this.send(
      {
        entityId: entityId,
        getEntityInfo: {},
      },
      'entityInfo'
    )
  }

  /**
   * Get the Map
   */
  async getMap() {
    return await this.send(
      {
        getMap: {},
      },
      'map'
    )
  }

  /**
   * Get the ingame time
   */
  async getTime() {
    return await this.send(
      {
        getTime: {},
      },
      'time'
    )
  }

  /**
   * Get all map markers
   */
  async getMapMarkers() {
    return await this.send(
      {
        getMapMarkers: {},
      },
      'mapMarkers'
    )
  }

  /**
   * Get the server info
   */
  async getInfo() {
    return await this.send(
      {
        getInfo: {},
      },
      'info'
    )
  }

  /**
   * Get team info
   */
  async getTeamInfo() {
    return await this.send(
      {
        getTeamInfo: {},
      },
      'teamInfo'
    )
  }
}
