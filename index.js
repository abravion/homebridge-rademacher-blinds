var request = require("request");
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform("homebridge-rademacher-blinds", "RademacherBlinds", RademacherBlinds, true);
};

function RademacherBlinds(log, config, api) {
    // global vars
    this.log = log;

    var self = this;

    // configuration vars
    this.url = config["url"];
    this.accessories = [];

    if (api) {
        this.api = api;

        this.api.on('didFinishLaunching', function() {
            request.get({
                timeout: 1500,
                strictSSL: false,
                url: this.url + "?devices=1"
            }, function(e,r,b){
                if(e) return new Error("Request failed.");
                var body = JSON.parse(b);
                body.devices.forEach(function(data) {
                    if(data.productName.includes("RolloTron") || data.productName.includes("Troll Comfort") || data.productName.includes("Rohrmotor") || data.productName.includes("Schaltaktor 2-Kanal"))
                    {
                        var uuid = UUIDGen.generate(data.serial);
                        var accessory = self.accessories[uuid];

                        if (accessory === undefined) {
                            self.addAccessory(data);
                        }
                        else {
                            self.log("Online: %s [%s]", accessory.displayName, data.serial);
                            self.accessories[uuid] = new RademacherBlindsAccessory(self.log, (accessory instanceof RademacherBlindsAccessory ? accessory.accessory : accessory), data, self.url);
                        }
                    }
                });
            });
        }.bind(this));
    }
}

RademacherBlinds.prototype.configureAccessory = function(accessory) {
    this.accessories[accessory.UUID] = accessory;
};

RademacherBlinds.prototype.addAccessory = function(blind) {
    this.log("Found: %s - %s [%s]", blind.name, blind.description, blind.serial);

    var name = null;
    if(!blind.description.trim())
        name = blind.name;
    else
        name = blind.description;
    var accessory = new Accessory(name, UUIDGen.generate(blind.serial));
    accessory.addService(Service.WindowCovering, name);
    this.accessories[accessory.UUID] = new RademacherBlindsAccessory(this.log, accessory, blind, this.url);

    this.api.registerPlatformAccessories("homebridge-rademacher-blinds", "RademacherBlinds", [accessory]);
};

RademacherBlinds.prototype.removeAccessory = function(accessory) {
    if (accessory) {
        this.log("[" + accessory.description + "] Removed from HomeBridge.");
        if (this.accessories[accessory.UUID]) {
            delete this.accessories[accessory.UUID];
        }
        this.api.unregisterPlatformAccessories("homebridge-rademacher-blinds", "RademacherBlinds", [accessory]);
    }
};

function RademacherBlindsAccessory(log, accessory, blind, url) {
    var self = this;

    var info = accessory.getService(Service.AccessoryInformation);

    accessory.context.manufacturer = "Rademacher";
    info.setCharacteristic(Characteristic.Manufacturer, accessory.context.manufacturer.toString());

    accessory.context.model = blind.productName;
    info.setCharacteristic(Characteristic.Model, accessory.context.model.toString());

    accessory.context.serial = blind.serial;
    info.setCharacteristic(Characteristic.SerialNumber, accessory.context.serial.toString());

    this.accessory = accessory;
    this.blind = blind;
    this.log = log;
    this.url = url;
    this.lastPosition = reversePercentage(this.blind.position);
    this.currentPositionState = 2;
    this.currentTargetPosition = 100;

    this.service = accessory.getService(Service.WindowCovering);

    this.service
        .getCharacteristic(Characteristic.CurrentPosition)
        .setValue(reversePercentage(self.blind.position))
        .on('get', this.getCurrentPosition.bind(this));

    this.service
        .getCharacteristic(Characteristic.TargetPosition)
        .setValue(reversePercentage(self.blind.position))
        .on('get', this.getTargetPosition.bind(this))
        .on('set', this.setTargetPosition.bind(this));

    this.service.getCharacteristic(Characteristic.PositionState)
        .setValue(this.currentPositionState)
        .on('get', this.getPositionState.bind(this));

    accessory.updateReachability(true);
}

RademacherBlindsAccessory.prototype.setTargetPosition = function(value, callback) {
    this.log("%s - Setting target position: %s", this.accessory.displayName, value);

    var self = this;
    this.currentTargetPosition = value;
    var moveUp = (this.currentTargetPosition >= this.lastPosition);
    this.service.setCharacteristic(Characteristic.PositionState, (moveUp ? 1 : 0));

    var params = "cid=9&did="+this.blind.did+"&command=1&goto="+reversePercentage(value);
    request.post({
        headers: {'content-type' : 'application/x-www-form-urlencoded'},
        url: this.url,
        body: params
    }, function(e,r,b){
        if(e) return callback(new Error("Request failed."), false);
        if(r.statusCode == 200)
        {
            self.service.setCharacteristic(Characteristic.CurrentPosition, self.currentTargetPosition);
            self.service.setCharacteristic(Characteristic.PositionState, 2);
            self.lastPosition = self.currentTargetPosition;
            callback(null, self.currentTargetPosition);
        }
    });
};

RademacherBlindsAccessory.prototype.getTargetPosition = function(callback) {
    this.log("%s - Getting target position", this.accessory.displayName);

    var self = this;
    var serial = this.blind.serial;

    request.get({
        timeout: 1500,
        strictSSL: false,
        url: this.url + "?devices=1"
    }, function(e,r,b) {
        if(e) return callback(new Error("Request failed."), false);
        var body = JSON.parse(b);
        body.devices.forEach(function(data) {
            if(data.serial == serial)
            {
                var pos = reversePercentage(data.position);
                self.currentTargetPosition = pos;
                callback(null, pos);
            }
        });
    });
};

RademacherBlindsAccessory.prototype.getCurrentPosition = function(callback) {
    this.log("%s - Getting current position", this.accessory.displayName);

    var self = this;
    var serial = this.blind.serial;

    request.get({
        timeout: 1500,
        strictSSL: false,
        url: this.url + "?devices=1"
    }, function(e,r,b) {
        if(e) return callback(new Error("Request failed."), false);
        var body = JSON.parse(b);
        body.devices.forEach(function(data) {
            if(data.serial == serial)
            {
                var pos = reversePercentage(data.position);
                callback(null, pos);
            }
        });
    });
};

RademacherBlindsAccessory.prototype.getPositionState = function(callback) {
    callback(null, this.currentPositionState);
};

function reversePercentage(p) {
    var min = 0;
    var max = 100;
    return (min + max) - p;
}
