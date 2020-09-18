import {
  ControlPacket,
  ControlType,
  StoneMultiSwitchPacket,
  MeshMultiSwitchPacket,
  ControlPacketsGenerator, Util, SessionData
} from "crownstone-core";

import {UartTxType} from "../declarations/enums";
import {UartWrapper} from "./uartPackets/UartWrapper";
import {UartLinkManager} from "./UartLinkManager";
import {UartWrapperV2} from "./uartPackets/UartWrapperV2";


export class UartManager {

  link : UartLinkManager;
  encryptionKey : Buffer = null;
  sessionData   : SessionData = null;
  deviceId: number = 42;


  constructor(autoReconnect = true) {
    this.link = new UartLinkManager(autoReconnect);

    this.sessionData = new SessionData();
    this.sessionData.generate();
  }


  setKey(key : string | Buffer) {
    if (typeof key === 'string') {
      this.encryptionKey = Util.prepareKey(key);
    }
    else {
      this.encryptionKey = key;
    }
  }


  refreshSessionData() {
    this.sessionData.generate();
  }


  switchCrownstones(switchData : SwitchData[]) : Promise<void> {
    // create a stone switch state packet to go into the multi switch
    let packets : StoneMultiSwitchPacket[] = [];
    switchData.forEach((data) => {
      switch (data.type) {
        case "TURN_ON":
          return packets.push(new StoneMultiSwitchPacket(data.stoneId, 255));
        case "TURN_OFF":
          return packets.push(new StoneMultiSwitchPacket(data.stoneId, 0));
        case "PERCENTAGE":
          return packets.push(new StoneMultiSwitchPacket(data.stoneId, data.percentage));
      }
    });

    // wrap it in a mesh multi switch packet
    let meshMultiSwitchPacket = new MeshMultiSwitchPacket(packets).getPacket();

    // wrap that in a control packet
    let controlPacket = new ControlPacket(ControlType.MULTISWITCH).loadByteArray(meshMultiSwitchPacket).getPacket();

    // finally wrap it in an Uart packet
    let uartPacket = new UartWrapper(UartTxType.CONTROL, controlPacket)

    this.write(uartPacket)

    return new Promise((resolve, reject) => { setTimeout(() => { resolve() }, 100); });
  }


  registerTrackedDevice(
    trackingNumber:number,
    locationUID:number,
    profileId:number,
    rssiOffset:number,
    ignoreForPresence:boolean,
    tapToToggleEnabled:boolean,
    deviceToken:number,
    ttlMinutes:number
  ) : Promise< void > {
    // create a stone switch state packet to go into the multi switch
    let registrationPacket = ControlPacketsGenerator.getRegisterTrackedDevicesPacket(
      trackingNumber,
      locationUID,
      profileId,
      rssiOffset,
      ignoreForPresence,
      tapToToggleEnabled,
      deviceToken,
      ttlMinutes
    );

    let uartPacket = new UartWrapper(UartTxType.CONTROL, registrationPacket);

    this.write(uartPacket)

    return new Promise((resolve, reject) => { setTimeout(() => { resolve() }, 100); });
  }


  setTime(customTimeInSeconds?: number) {
    if (!customTimeInSeconds) {
      customTimeInSeconds = Util.nowToCrownstoneTime();
    }

    let setTimePacket = ControlPacketsGenerator.getSetTimePacket(customTimeInSeconds);

    let uartPacket = new UartWrapper(UartTxType.CONTROL, setTimePacket)

    this.write(uartPacket)
    return new Promise((resolve, reject) => { setTimeout(() => { resolve() }, 100); });
  }


  write(uartMessage: UartWrapperV2) {
    // TODO: INSERT DEVICE ID
    uartMessage.setDeviceId(this.deviceId)
    if (this.encryptionKey !== null) {
      // ENCRYPT
      this.link.write(uartMessage.getEncryptedPacket(this.sessionData, this.encryptionKey));
    }
    else {
      this.link.write(uartMessage.getPacket());
    }
  }

}