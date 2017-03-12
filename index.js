var request = require("request");
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform("homebridge-rademacher-switchs", "RademacherSwitchs", RademacherSwitchs, true);
};

function RademacherSwitchs(log, config, api) {
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
                    if(data.productName.includes("Schaltaktor 2-Kanal"))
                    {
                        var uuid = UUIDGen.generate(data.serial);
                        var accessory = self.accessories[uuid];

                        if (accessory === undefined) {
                            self.addAccessory(data);
                        }
                        else {
                            self.log("Online: %s [%s]", accessory.displayName, data.serial);
                            self.accessories[uuid] = new RademacherSwitchsAccessory(self.log, (accessory instanceof RademacherSwitchsAccessory ? accessory.accessory : accessory), data, self.url);
                        }
                    }
                });
            });
        }.bind(this));
    }
}

RademacherSwitchs.prototype.configureAccessory = function(accessory) {
    this.accessories[accessory.UUID] = accessory;
};

RademacherSwitchs.prototype.addAccessory = function(Switch) {
    this.log("Found: %s - %s [%s]", Switch.name, Switch.description, Switch.serial);

    var name = null;
    if(!Switch.description.trim())
        name = Switch.name;
    else
        name = Switch.description;
    var accessory = new Accessory(name, UUIDGen.generate(Switch.serial));
    accessory.addService(Service.WindowCovering, name);
    this.accessories[accessory.UUID] = new RademacherSwitchsAccessory(this.log, accessory, Switch, this.url);

    this.api.registerPlatformAccessories("homebridge-rademacher-switchs", "RademacherSwitchs", [accessory]);
};

RademacherSwitchs.prototype.removeAccessory = function(accessory) {
    if (accessory) {
        this.log("[" + accessory.description + "] Removed from HomeBridge.");
        if (this.accessories[accessory.UUID]) {
            delete this.accessories[accessory.UUID];
        }
        this.api.unregisterPlatformAccessories("homebridge-rademacher-switchs", "RademacherSwitchs", [accessory]);
    }
};

function RademacherSwitchsAccessory(log, accessory, Switch, url) {
    var self = this;

    var info = accessory.getService(Service.AccessoryInformation);

    accessory.context.manufacturer = "Rademacher";
    info.setCharacteristic(Characteristic.Manufacturer, accessory.context.manufacturer.toString());

    accessory.context.model = Switch.productName;
    info.setCharacteristic(Characteristic.Model, accessory.context.model.toString());

    accessory.context.serial = Switch.serial;
    info.setCharacteristic(Characteristic.SerialNumber, accessory.context.serial.toString());

    this.accessory = accessory;
    this.Switch = Switch;
    this.log = log;
    this.url = url;
    this.lastPosition = reversePercentage(this.Switch.position);
    this.currentPositionState = 2;
    this.currentTargetPosition = 100;

    this.service = accessory.getService(Service.WindowCovering);

    this.service
        .getCharacteristic(Characteristic.CurrentPosition)
        .setValue(reversePercentage(self.Switch.position))
        .on('get', this.getCurrentPosition.bind(this));

    this.service
        .getCharacteristic(Characteristic.TargetPosition)
        .setValue(reversePercentage(self.Switch.position))
        .on('get', this.getTargetPosition.bind(this))
        .on('set', this.setTargetPosition.bind(this));

    this.service.getCharacteristic(Characteristic.PositionState)
        .setValue(this.currentPositionState)
        .on('get', this.getPositionState.bind(this));

    accessory.updateReachability(true);
}

RademacherSwitchsAccessory.prototype.setTargetPosition = function(value, callback) {
    this.log("%s - Setting target position: %s", this.accessory.displayName, value);

    var self = this;
    this.currentTargetPosition = value;
    var moveUp = (this.currentTargetPosition >= this.lastPosition);
    this.service.setCharacteristic(Characteristic.PositionState, (moveUp ? 1 : 0));

    var params = "cid=9&did="+this.Switch.did+"&command=1&goto="+reversePercentage(value);
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

RademacherSwitchsAccessory.prototype.getTargetPosition = function(callback) {
    this.log("%s - Getting target position", this.accessory.displayName);

    var self = this;
    var serial = this.Switch.serial;

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

RademacherSwitchsAccessory.prototype.getCurrentPosition = function(callback) {
    this.log("%s - Getting current position", this.accessory.displayName);

    var self = this;
    var serial = this.Switch.serial;

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

RademacherSwitchsAccessory.prototype.getPositionState = function(callback) {
    callback(null, this.currentPositionState);
};

function reversePercentage(p) {
    var min = 0;
    var max = 100;
    return (min + max) - p;
}
