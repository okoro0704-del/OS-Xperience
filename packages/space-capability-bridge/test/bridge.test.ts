import test from "node:test"; import assert from "node:assert/strict";
import { CapabilityRegistry, createDescriptorProvider, resolveExperienceCapabilities } from "../src/index.ts";
const p=(id:string,state:any="AVAILABLE",priority=0,name=`p-${id}-${state}-${priority}`)=>createDescriptorProvider(name,"1",x=>x===id,()=>({state}),priority);
const result=async(state:any,req:any="REQUIRED")=>{const r=new CapabilityRegistry();r.register(p("cap",state));return resolveExperienceCapabilities([{id:"cap",requirement:req}],r)};
const cases:[string,()=>Promise<void>|void][]=[
["1 empty registry",()=>assert.equal(new CapabilityRegistry().list().length,0)],
["2 register provider",()=>{const r=new CapabilityRegistry();r.register(p("a"));assert.equal(r.list().length,1)}],
["3 list provider",()=>{const r=new CapabilityRegistry();r.register(p("a","AVAILABLE",0,"named"));assert.equal(r.list()[0]?.providerId,"named")}],
["4 unregister provider",()=>{const r=new CapabilityRegistry();r.register(p("a","AVAILABLE",0,"x"));r.unregister("x");assert.equal(r.list().length,0)}],
["5 unsupported",async()=>assert.equal((await new CapabilityRegistry().resolve("none")).reason,"NO_PROVIDER")],
...[ ["6 required available","AVAILABLE","REQUIRED","READY"],["7 required degraded","DEGRADED","REQUIRED","DEGRADED"],["8 required unavailable","UNAVAILABLE","REQUIRED","BLOCKED"],["9 required not implemented","NOT_IMPLEMENTED","REQUIRED","BLOCKED"],["10 optional available","AVAILABLE","OPTIONAL","READY"],["11 optional degraded","DEGRADED","OPTIONAL","DEGRADED"],["12 optional unavailable","UNAVAILABLE","OPTIONAL","READY"],["13 optional not implemented","NOT_IMPLEMENTED","OPTIONAL","READY"],["26 optional call","NOT_IMPLEMENTED","OPTIONAL","READY"],["27 required call","NOT_IMPLEMENTED","REQUIRED","BLOCKED"] ] .map(([n,s,q,e])=>[n,async()=>assert.equal((await result(s,q)).experienceState,e)] as [string,()=>Promise<void>]),
["14 mixed",async()=>{const r=new CapabilityRegistry();r.register(p("space.tv"));r.register(p("space.call","NOT_IMPLEMENTED"));assert.equal((await resolveExperienceCapabilities([{id:"space.tv",requirement:"REQUIRED"},{id:"space.call",requirement:"OPTIONAL"}],r)).experienceState,"READY")}],
["15 mixed blocked",async()=>{const r=new CapabilityRegistry();r.register(p("space.tv"));r.register(p("space.radio","UNAVAILABLE"));assert.equal((await resolveExperienceCapabilities([{id:"space.tv",requirement:"REQUIRED"},{id:"space.radio",requirement:"REQUIRED"}],r)).experienceState,"BLOCKED")}],
["16 mixed degraded",async()=>{const r=new CapabilityRegistry();r.register(p("space.tv","DEGRADED"));assert.equal((await resolveExperienceCapabilities([{id:"space.tv",requirement:"REQUIRED"}],r)).experienceState,"DEGRADED")}],
["17 no provider",async()=>{const x=await new CapabilityRegistry().resolve("unknown");assert.equal(x.state,"UNAVAILABLE");assert.equal(x.reason,"NO_PROVIDER")}],
["18 provider exception",async()=>{const r=new CapabilityRegistry();r.register({providerId:"bad",version:"1",supports:()=>true,resolve:()=>{throw Error()}});assert.equal((await r.resolve("x")).reason,"PROVIDER_FAILURE")}],
["19 malformed provider",async()=>{const r=new CapabilityRegistry();r.register({providerId:"bad",version:"1",supports:()=>true,resolve:()=>({}) as any});assert.equal((await r.resolve("x")).reason,"MALFORMED_PROVIDER_RESULT")}],
["20 priority",async()=>{const r=new CapabilityRegistry();r.register(p("x","AVAILABLE",1,"low"));r.register(p("x","DEGRADED",2,"high"));assert.equal((await r.resolve("x")).providerId,"high")}],
["21 equal priority",async()=>{const r=new CapabilityRegistry();r.register(p("x","AVAILABLE",1,"first"));r.register(p("x","DEGRADED",1,"second"));assert.equal((await r.resolve("x")).providerId,"first")}],
["22 repeated deterministic",async()=>{const r=new CapabilityRegistry();r.register(p("x"));assert.equal((await r.resolve("x")).providerId,(await r.resolve("x")).providerId)}],
["23 duplicate declarations",async()=>{const r=new CapabilityRegistry();r.register(p("x"));assert.equal(Object.keys((await resolveExperienceCapabilities([{id:"x",requirement:"REQUIRED"},{id:"x",requirement:"OPTIONAL"}],r)).capabilities).length,1)}],
["24 empty experience",async()=>assert.equal((await resolveExperienceCapabilities([],new CapabilityRegistry())).experienceState,"READY")],
["25 demo sensor",async()=>{const r=new CapabilityRegistry();r.register(p("demo.sensor","AVAILABLE",0,"demo-provider"));assert.equal((await resolveExperienceCapabilities([{id:"demo.sensor",requirement:"REQUIRED"}],r)).experienceState,"READY")}]
]; for(const [name,run] of cases)test(name,run);
