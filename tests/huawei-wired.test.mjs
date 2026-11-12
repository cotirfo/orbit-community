import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHuaweiClient,normalizeHuawei} from '../huawei.mjs';

const mac='AA:BB:CC:DD:EE:01';
test('administrator MAC protection survives DHCP address changes',()=>{
 const data={hosts:[{MACAddress:mac,IPAddress:'192.168.3.20',Layer2Interface:'SSID1',Active:true}],filters:[{MACAddressControlEnabled:true,MacFilterPolicy:false}],protectedMacs:[mac.toLowerCase()]};
 for(const ip of ['192.168.3.20','192.168.3.99']){
  data.hosts[0].IPAddress=ip;
  const device=normalizeHuawei(data).devices[0];
  assert.equal(device.administratorProtected,true);assert.equal(device.canBlock,false);assert.equal(device.canLimit,false);assert.equal(device.canRename,true);
 }
});
test('Huawei WAN transport requires an approved origin, Ethernet source and explicit certificate pin',()=>{
 assert.throws(()=>createHuaweiClient({origin:'https://example.test/admin'}),/não permitido/);
 assert.throws(()=>createHuaweiClient({origin:'https://192.0.2.2'}),/origem Ethernet/);
 assert.throws(()=>createHuaweiClient({origin:'https://192.0.2.2',sourceIp:'192.0.2.49'}),/SHA256/);
 assert.throws(()=>createHuaweiClient({protectedMacs:['invalid']}),/MAC/);
});
