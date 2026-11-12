import {loadSettings} from './settings.mjs';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';

const {config}=loadSettings();
if(config.lan?.enabled&&config.lan.listenAddress!=='0.0.0.0'){
  const address=config.lan.listenAddress,deadline=Date.now()+60000;
  while(!Object.values(os.networkInterfaces()).flat().some(row=>row?.address===address)){
    if(Date.now()>=deadline)throw new Error('ORBIT: aguardando o endereco do painel '+address+'. O systemd tentara novamente.');
    await delay(1000);
  }
  console.log('ORBIT: endereco do painel disponivel em '+address+'.');
}
