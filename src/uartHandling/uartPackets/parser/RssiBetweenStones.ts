import {DataStepper} from "crownstone-core";

export class RssiBetweenStones {
  type          : number;
  receiverId    : number;
  senderId      : number;
  rssi37        : number;
  rssi38        : number;
  rssi39        : number;
  lastSeen      : number;
  messageNumber : number;

  valid = false;

  constructor(data : Buffer) {
    this.load(data);
  }

  load(data : Buffer) {
    let minSize = 7;

    if (data.length >= minSize) {
      this.valid = true;

      let stepper = new DataStepper(data);

      this.type          = stepper.getUInt8();
      this.receiverId    = stepper.getUInt8();
      this.senderId      = stepper.getUInt8();
      this.rssi37        = stepper.getInt8();
      this.rssi38        = stepper.getInt8();
      this.rssi39        = stepper.getInt8();
      this.lastSeen      = stepper.getUInt8();
      this.messageNumber = stepper.getUInt8();
    }
    else {
      this.valid = false
    }
  }

  getJSON() : TopologyUpdateData {
    return {
      type       : this.type,
      receiverId : this.receiverId,
      senderId   : this.senderId,
      rssi37     : this.rssi37,
      rssi38     : this.rssi38,
      rssi39     : this.rssi39,
      lastSeen   : this.lastSeen,
      messageNumber : this.messageNumber,
    }
  }
}


