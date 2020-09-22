import {UartWrapperPacket} from "./uartPackets/UartWrapperPacket";
import {eventBus} from "../singletons/EventBus";
import {ServiceData} from "crownstone-core/dist/packets/ServiceData";
import {UartRxType} from "../declarations/enums";
import {ControlType, ResultPacket} from "crownstone-core";
import {HelloPacket} from "./contentPackets/Hello";
import {Logger} from "../Logger";
const log = Logger(__filename, true)

const MeshDataUniquenessChecker = {};

export class UartParser {

  static parse(dataPacket : UartWrapperPacket) {
    let opCode = dataPacket.opCode;
    let parsedData = null;

    if (dataPacket.valid === false) {
      console.log("Invalid packet, maybe wrong protocol?");
      return;
    }


    if (opCode === UartRxType.HELLO) {
      let hello = new HelloPacket(dataPacket.payload);
      if (hello.valid) {
        eventBus.emit("HelloReceived", {sphereId: hello.sphereUID, status: hello.status});
      }
      else {
        console.log("invalid hello packet", dataPacket.payload)
      }
    }
    else if (opCode === UartRxType.HEARTBEAT) {
      if (dataPacket.payload.length === 2) {
        eventBus.emit("HeartBeat", {timeout: dataPacket.payload.readUInt16LE(0)});
      }else {
        console.log("invalid HEARTBEAT packet", dataPacket.payload)
      }
    }
    else if (opCode === UartRxType.STATUS) {
      if (dataPacket.payload.length === 1) {
        eventBus.emit("HeartBeat", {timeout: dataPacket.payload.readUInt8(0)});
      }else {
        console.log("invalid STATUS packet", dataPacket.payload)
      }
    }
    else if (opCode === UartRxType.SESSION_NONCE) {
      if (dataPacket.payload.length === 5) {
        eventBus.emit("SessionNonceReceived", {timeout: dataPacket.payload});
      }else {
        console.log("invalid session nonce packet", dataPacket.payload)
      }
    }
    else if (opCode == UartRxType.OWN_SERVICE_DATA) {
      // console.log("Got Own service data")
      let serviceData = new ServiceData(dataPacket.payload);
      serviceData.parse();
      if (serviceData.validData) {
        eventBus.emit("SelfServiceData", serviceData.getJSON());
      }
    }
    else if (opCode == UartRxType.RESULT_PACKET) {
      let packet = new ResultPacket(dataPacket.payload);
      if (packet.commandType === ControlType.UART_MESSAGE) {
        log.verbose("resultPacket", packet);
      }
      else {
        log.debug("resultPacket", packet);
      }
      eventBus.emit("resultPacket", packet);
    }
    else if (opCode == UartRxType.MESH_SERVICE_DATA) {
      let serviceData = new ServiceData(dataPacket.payload, true);
      serviceData.parse()
      if (serviceData.validData) {
        if (MeshDataUniquenessChecker[serviceData.crownstoneId] !== serviceData.uniqueIdentifier) {
          MeshDataUniquenessChecker[serviceData.crownstoneId] = serviceData.uniqueIdentifier;
          log.debug("MeshServiceData", serviceData.getJSON())
          eventBus.emit("MeshServiceData", serviceData.getJSON())
        }
      }
      else {
        console.log(new Date().toLocaleString(), "Invalid mesh data from:", serviceData.crownstoneId)
      }
    }
    else if (opCode == UartRxType.CROWNSTONE_ID) {
      console.log("Got Crownstone Id")
      // id = Conversion.int8_to_uint8(dataPacket.payload)
      // CrownstoneEventBus.emit(DevTopics.ownCrownstoneId, id)
    }
    else if (opCode == UartRxType.MAC_ADDRESS) {
      console.log("Got MAC address")
      // if (addr !== "") {
      //     // CrownstoneEventBus.emit(DevTopics.ownMacAddress, addr)
      // }
      // else {
      //     // console.log("invalid address) {", dataPacket.payload)
      // }
    }
    else if (opCode == UartRxType.POWER_LOG_CURRENT) {
      console.log("Got MAC address")
      // type is CurrentSamples
      // parsedData = CurrentSamplesPacket(dataPacket.payload)
      // CrownstoneEventBus.emit(DevTopics.newCurrentData, parsedData.getDict())
    }
    else if (opCode == UartRxType.POWER_LOG_VOLTAGE) {
      // type is VoltageSamplesPacket
      // parsedData = VoltageSamplesPacket(dataPacket.payload)
      // CrownstoneEventBus.emit(DevTopics.newVoltageData, parsedData.getDict())
    }
    else if (opCode == UartRxType.POWER_LOG_FILTERED_CURRENT) {
      // type is CurrentSamples
      // parsedData = CurrentSamplesPacket(dataPacket.payload)
      // CrownstoneEventBus.emit(DevTopics.newFilteredCurrentData, parsedData.getDict())
    }
    else if (opCode == UartRxType.POWER_LOG_FILTERED_VOLTAGE) {
      // type is VoltageSamplesPacket
      // parsedData = VoltageSamplesPacket(dataPacket.payload)
      // CrownstoneEventBus.emit(DevTopics.newFilteredVoltageData, parsedData.getDict())
    }
    else if (opCode == UartRxType.POWER_LOG_POWER) {
      // type is PowerCalculationsPacket
      // parsedData = PowerCalculationPacket(dataPacket.payload)
      // CrownstoneEventBus.emit(DevTopics.newCalculatedPowerData, parsedData.getDict())
    }
    else if (opCode == UartRxType.ADC_CONFIG) {
      // type is PowerCalculationsPacket
      // parsedData = AdcConfigPacket(dataPacket.payload)
      // CrownstoneEventBus.emit(DevTopics.newAdcConfigPacket, parsedData.getDict())
    }
    else if (opCode == UartRxType.ADC_RESTART) {
      // CrownstoneEventBus.emit(DevTopics.adcRestarted, null)
    }
    else if (opCode == UartRxType.EXTERNAL_STATE_PART_0) {
      // CrownstoneEventBus.emit(DevTopics.adcRestarted, null)
    }
    else if (opCode == UartRxType.EXTERNAL_STATE_PART_1) {
      // CrownstoneEventBus.emit(DevTopics.adcRestarted, null)
    }
    else if (opCode == UartRxType.ASCII_LOG) {
      let stringResult = ""
      for (let i = 0; i< dataPacket.payload.length; i++) {
        let byte = dataPacket.payload[i];
        if (byte < 128) {
          stringResult += String.fromCharCode(byte);
        }
      }
      console.log("LOG:", new Date().valueOf(),":"+stringResult)
    }
    else if (opCode == UartRxType.UART_MESSAGE) {
      if (dataPacket.payload.toString() !== 'ping') {
        let string =  dataPacket.payload.toString();
        log.verbose("UartMessage", string);
        eventBus.emit("UartMessage", {string: string, data: dataPacket.payload})
      }
    }
    else {
      console.log("Unknown OpCode", opCode, dataPacket)
    }

    parsedData = null;
  }

}