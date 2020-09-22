import SerialPort from 'serialport'
import {UartLink} from "./UartLink";
import {getSnapSerialList} from "./snapDiscovery";
import {CONFIG} from "../config/config";
import {UartWrapperV2} from "./uartPackets/UartWrapperV2";
import {Util} from "crownstone-core";
import {UartEncryptionContainer} from "./UartEncryptionContainer";


let updatePorts = function() { return Promise.resolve({})}

if (CONFIG.useSearchById) {
  updatePorts = function() {
    return getSnapSerialList()
  }
}
else {
  updatePorts = function() {
    return new Promise((resolve, reject) => {
      let availablePorts = {};
      SerialPort.list().then((ports) => {
        ports.forEach((port) => {
          availablePorts[port.path] = {port: port, connected: false};
        });
        resolve(availablePorts);
      });
    })
  }
}

import {Logger} from "../Logger";
const log = Logger(__filename);

export class UartLinkManager {
  autoReconnect = false;

  encryptionContainer: UartEncryptionContainer;
  port : UartLink = null;
  connected = false;
  triedPorts = [];

  forcedPort = null;

  constructor(autoReconnect, encryptionContainer: UartEncryptionContainer) {
    this.encryptionContainer = encryptionContainer;
    this.autoReconnect = autoReconnect;
  }

  start(forcedPort = null) : Promise<void> {
    this.forcedPort = forcedPort;
    return this.initiateConnection();
  }

  async restart() : Promise<void> {
    this.connected = false;
    if (this.autoReconnect) {
      this.port = null;
      this.triedPorts = [];
      await Util.wait(100);
      return this.initiateConnection();
    }
  }

  close() : Promise<void> {
    return this.port.destroy();
  }


  initiateConnection() : Promise<void> {
    let promise;
    if (this.forcedPort) {
      promise = this.tryConnectingToPort(this.forcedPort);
    }
    else {
      promise = updatePorts()
        .then((available) => {
          log.info("Available ports on the system", available);
          let ports = available;
          let portPaths = Object.keys(ports);
          return Util.promiseBatchPerformer(portPaths, (port) => {
            // we found a match. Do not try further
            if (this.connected) { return Promise.resolve(); }

            if (CONFIG.useManufacturer === false || CONFIG.useSearchById) {
              if (this.triedPorts.indexOf(port) === -1) {
                return this.tryConnectingToPort(port);
              }
            }
            else {
              let manufacturer = ports[port].port?.manufacturer;
              // we use indexOf to check if a part of this string is in the manufacturer. It can possibly differ between platforms.
              if (manufacturer && (manufacturer.indexOf("Silicon Lab") !== -1 || manufacturer.indexOf("SEGGER") !== -1)) {
                if (this.triedPorts.indexOf(port) === -1) {
                  return this.tryConnectingToPort(port);
                }
              }
            }
            return Promise.resolve();
          })
        })
        .then(() => {
          // Handle the case where none of the connected devices match.
          if (this.port === null) {
            log.info("Could not find a Crownstone USB connected.");
            throw "COULD_NOT_OPEN_CONNECTION_TO_UART";
          }
        })
    }

    return promise.catch((err) => {
      log.info("initiateConnection error", err)
      this.triedPorts = [];
      if (this.autoReconnect) {
        return new Promise((resolve, reject) => {
          setTimeout(() => { resolve(); }, 500);
        })
          .then(() => {
            return this.initiateConnection();
          })
      }
      else {
        throw err;
      }
    })
  }

  tryConnectingToPort(port)  : Promise<void> {
    return new Promise((resolve, reject) => {
      this.connected = false;
      log.info("Trying port", port);
      this.triedPorts.push(port);
      let link = new UartLink(() => { this.restart(); }, this.encryptionContainer);
      link.tryConnectingToPort(port)
        .then(() => {
          log.info("Successful connection to ", port);
          this.port = link;
          this.connected = true;
          resolve();
        })
        .catch((err) => {
          log.info("Failed connection", port, err);
          reject(err);
        })
    })
  }


  async write(data: Buffer) {
    // handle encryption here.
    return await this.port.write(data);
  }

}