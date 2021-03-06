import SerialPort from 'serialport'
import {UartReadBuffer} from "./UartReadBuffer";
import {UartParser} from "./UartParser";
import {eventBus} from "../singletons/EventBus";

import {Logger, LogThrottle} from "../Logger";
import {UartWrapperPacketV2} from "./uartPackets/UartWrapperPacketV2";
import {UartWrapperV2} from "./uartPackets/UartWrapperV2";
import {UartTxType} from "../declarations/enums";
import {UartTransferOverhead} from "./containers/UartTransferOverhead";
import {UartMessageQueue} from "./containers/UartMessageQueue";
import {topics} from "../declarations/topics";
import {HelloPacket} from "./contentPackets/rx/Hello";
import {ControlStateSetPacket, ResultPacket, StateType} from "crownstone-core";
import {HelloTXPacket} from "./contentPackets/tx/HelloTx";
import {getSessionNonceTx} from "./contentPackets/tx/SessionNonceTx";
import {HubStatusTx} from "./contentPackets/tx/HubStatusTx";

const log = Logger(__filename);

const encryptedDataTypes = {
  [UartTxType.HEARTBEAT]: true,
  // [UartTxType.STATUS]: true,
  [UartTxType.CONTROL]: true,
  [UartTxType.HUB_DATA_REPLY]: true,
};

export class UartLink {
  port    : SerialPort = null;
  success : boolean    = false;

  readBuffer : UartReadBuffer = null;

  parser;
  resolver;
  rejecter;
  pingInterval;
  refreshSessionNonceInterval;
  refreshingSessionData = false;

  unsubscribeEvents : (() => void)[] = [];
  unsubscribeHello  =  () => {};
  reconnectionCallback;
  heartBeatInterval = null;

  transferOverhead: UartTransferOverhead;
  queue : UartMessageQueue;

  errorHandled = false;
  closed       = false;

  constructor(reconnectionCallback, transferOverhead : UartTransferOverhead) {
    this.queue = new UartMessageQueue((data) => { return this._write(data); })
    this.transferOverhead = transferOverhead;
    this.reconnectionCallback = reconnectionCallback;

    // the read buffer will parse the message's outer container (start, end, crc);
    let parseCallback = (data : UartWrapperPacketV2) => { UartParser.parse(data) };
    this.readBuffer = new UartReadBuffer(parseCallback, transferOverhead);

    // load new, updated session nonce data into the container.
    this.unsubscribeEvents.push( eventBus.on( topics.SessionNonceReceived,(data: Buffer) => {
      transferOverhead.setIncomingSessionData(data);
    }));
    this.unsubscribeEvents.push( eventBus.on( topics.SessionNonceMissing,() => {
      this.refreshSessionData();
    }));

    this.unsubscribeEvents.push( eventBus.on( topics.HelloReceived,async (data: HelloPacket) => {
      log.info("Hello packet received", data);
      // check if the encryption is enabled.
      if (data.encryptionRequired) {
        await this.refreshSessionData();
      }
      else {
        this.transferOverhead.encryption.enabled = false;
      }
      if (this.transferOverhead.mode === "HUB" && data.hubMode !== true) {
        await this.setHubMode();
      }
      await this.setStatus();
    }));
  }

  async refreshSessionData(timeoutMinutes = 30) {
    if (this.transferOverhead.encryption.keyIsSet === false) {
      log.info("Encryption is required, but no key is loaded. Please load an encryption key using .setKey(key : string | Buffer)");
      eventBus.emit(topics.KeyRequested);
    }

    if (this.refreshingSessionData) { return; }
    this.refreshingSessionData = true;

    this.transferOverhead.encryption.enabled = true;
    clearTimeout(this.refreshSessionNonceInterval);

    this.refreshSessionNonceInterval = setTimeout(() => {
      this.refreshSessionData(timeoutMinutes)
    }, 0.8*timeoutMinutes*60*1000);

    this.transferOverhead.refreshSessionData();
    let sessionNoncePacket = getSessionNonceTx(timeoutMinutes, this.transferOverhead.encryption.outgoingSessionData);
    try {
      await this.write(sessionNoncePacket);
    }
    catch(err) {
      log.warn("Failed to refresh session data", err);
    }
    finally {
      this.refreshingSessionData = false;
    }
  }

  async setHubMode() {
    // set state packet
    let setStatePacket = new ControlStateSetPacket(StateType.HUB_MODE).loadUInt8(this.transferOverhead.mode === "HUB" ? 1 : 0).getPacket()

    // which we wrap in an uart wrapper
    let packet = new UartWrapperV2(UartTxType.CONTROL, setStatePacket);

    await this.write(packet);
  }

  destroy() : Promise<void> {
    this.cleanup();
    return new Promise((resolve, reject) => {
      this.port.close(() => { resolve(); });
    })
  }

  connectionAttemptCompleted() {
    this.resolver = null;
    this.rejecter = null;
  }

  cleanup() {
    clearTimeout(this.refreshSessionNonceInterval);
    clearInterval(this.heartBeatInterval);
    this.unsubscribeHello();
    this.unsubscribeEvents.forEach((unsub) => { unsub(); });
    LogThrottle.reset();

    if (this.port)   { this.port.removeAllListeners();   }
    if (this.parser) { this.parser.removeAllListeners(); }

    clearInterval(this.pingInterval);

    this.transferOverhead.reset();
    this.queue.cleanup();
  }

  tryConnectingToPort(port)  : Promise<void> {
    return new Promise((resolve, reject) => {
      this.resolver = resolve;
      this.rejecter = reject;

      this.port   = new SerialPort(port,{ baudRate: 230400 });
      this.parser = new SerialPort.parsers.ByteLength({length: 1});
      this.port.pipe(this.parser);

      // bind all the events
      this.parser.on('data',(response) => { this.readBuffer.addByteArray(response); });
      this.port.on("open",  ()         => { this.handleNewConnection();             });
      this.port.on("close", ()         => { this.closeConnection();                 });
      this.port.on("error", (err)      => { this.handleError(err);                  });
    })
  }


  async handleNewConnection() {
    log.info("Setting up new connection...")
    // we will try a handshake.
    let closeTimeout = setTimeout(() => { if (!this.success) {
      log.info("Failed setting up connection, timeout");
      this.closeConnection();
      this.rejecter && this.rejecter("HANDSHAKE_FAILED");
      this.connectionAttemptCompleted();
    }}, 1000);

    this.unsubscribeHello = eventBus.on(topics.HelloReceived, () => {
      clearTimeout(closeTimeout);
      this.success = true;
      this.unsubscribeHello();
      this.heartBeatInterval = setInterval(() => { this.heartBeat()}, 2000);
      this.resolver && this.resolver();
      this.connectionAttemptCompleted();
    });

    try {
      let helloTX = new HelloTXPacket();
      helloTX.putStatus(this.transferOverhead.status);

      await this.write(helloTX.getWrapper())
      eventBus.emit(topics.ConnectionEstablished);
    }
    catch (err) {
      log.warn("Hello failed.", err);
      this.handleError(err);
    }
  }


  closeConnection() {
    if (this.closed) { return; }
    this.closed = true;

    clearInterval(this.heartBeatInterval);
    let connectionHasBeenSuccessful = this.success;
    this.port.close(() => { this.cleanup(); });
    if (connectionHasBeenSuccessful) {
      this.reconnectionCallback();
      this.reconnectionCallback = () => {};
    }
  }


  async setStatus() : Promise<void> {
    let statusPacket = new HubStatusTx();
    statusPacket.putStatus(this.transferOverhead.status);
    let packet = statusPacket.getWrapper();
    await this.write(packet);
  }

  handleError(err) {
    if (this.errorHandled) { return; }
    this.errorHandled = true;

    log.info("Connection error", err);
    this.closeConnection();
    this.rejecter && this.rejecter(err);
    this.connectionAttemptCompleted();
  }


  async heartBeat(allowEncryption = true) {
    try {
      let timeout = Buffer.alloc(2);
      timeout.writeUInt16LE(4, 0);
      let packet = new UartWrapperV2(UartTxType.HEARTBEAT, timeout);
      packet.encryptionAllowed = allowEncryption;
      await this.write(packet);
    }
    catch (err) {
      if (allowEncryption && this.transferOverhead.encryption.enabled && err?.code === "WRITE_ENCRYPTION_REJECTED") {
        log.notice("Encrypted Heartbeat failed. Attempting Heartbeat without encryption...");
        await this.heartBeat(false);
        log.notice("Success.");
      }
      else {
        log.warn("Heartbeat failed.", err);
      }
    }
  }


  async write(uartMessage: UartWrapperV2) : Promise<ResultPacket | void> {
    // handle encryption here.
    uartMessage.setDeviceId(this.transferOverhead.deviceId);
    let dataType = uartMessage.dataType
    let packet;
    if (
      uartMessage.encryptionAllowed &&
      this.transferOverhead.encryption.enabled      &&
      this.transferOverhead.encryption.key !== null &&
      encryptedDataTypes[dataType]
    ) {
      // ENCRYPT
      log.verbose("Encrypting packet...", uartMessage.getPacket().toJSON())
      let encryptedPacket = uartMessage.getEncryptedPacket(
        this.transferOverhead.encryption.outgoingSessionData,
        this.transferOverhead.encryption.key
      );
      packet = encryptedPacket;
    }
    else {
      packet = uartMessage.getPacket();
    }

    return new Promise<ResultPacket | void>((resolve, reject) => {
      this.queue.add(uartMessage.dataType, packet, resolve, reject);
    })
    .catch((err) => {
      if (err?.code !== "WRITE_ENCRYPTION_REJECTED" && err?.code !== 'MESSAGE_REJECTED') {
        this.handleError(err);
      }
      throw err;
    })
  }



  async _write(data : Buffer) : Promise<void> {
    if (this.transferOverhead.maxChunkSize == 0) {
      log.verbose("Writing packet")
      await this.__writePromise(data)
    }
    else {
      // writing in chunks solves issues writing to certain JLink chips. A max chunkSize of 64 was found to work well for our case.
      let chunkSize = this.transferOverhead.maxChunkSize
      let index = 0
      while ((index * chunkSize) < data.length) {
        let chunkedData = data.subarray(index * chunkSize, (index + 1) * chunkSize)
        index += 1
        await this.__writePromise(chunkedData);
      }
    }
  }


  /**
   * Simple util method that transforms the callback api of the serial lib to a promise.
   * @param data
   */
  __writePromise(data: Buffer) : Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.port.write(data, (err) => {
        if (err) {
          reject(err);
        }
        else {
          resolve()
        }
      });
    })
  }

}
