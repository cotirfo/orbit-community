import { loadSettings } from './settings.mjs';
import { startRuntime } from './runtime.mjs';
import { startConfiguredLanGateway } from './lan-gateway.mjs';
import { startConfiguredController } from './controller.mjs';

try{
  const settings=loadSettings();
  const runtime=await startRuntime(settings);
  let controller,gateway,closing=false;
  async function shutdown(){
    if(closing)return;
    closing=true;
    await Promise.allSettled([runtime.close(),controller?.close(),gateway?.close()]);
  }
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void shutdown());

  try{
    controller=await startConfiguredController(settings);
    runtime.panel.controlEnabled=Boolean(controller);
    runtime.panel.huaweiEnabled=Boolean(controller?.huaweiEnabled);
  }catch{
    console.error('Administração local indisponível. Confira a porta de controle e o armazenamento.');
  }
  try{
    gateway=await startConfiguredLanGateway(settings,{controlRelayKey:controller?.relayKey??''});
    runtime.panel.lanUrl=gateway?.url??null;
    runtime.panel.speedTestEnabled=Boolean(gateway?.speedTestEnabled);
  }catch(error){
    console.error(error.message);
  }
}catch(error){
  console.error(error.message);
  process.exitCode=1;
}
