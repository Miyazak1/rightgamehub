export const METRIC_UNIT_CONVERSION_VERSION='deterministic-units-v1';

const unit=(family,numerator,denominator=1n)=>Object.freeze({family,numerator:BigInt(numerator),denominator:BigInt(denominator)});
const units=Object.freeze({
  ms:unit('duration',1n,1000n),
  s:unit('duration',1n),
  min:unit('duration',60n),
  h:unit('duration',3600n),
  B:unit('storage',1n),
  kB:unit('storage',1000n),
  MB:unit('storage',1000000n),
  GB:unit('storage',1000000000n),
  KiB:unit('storage',1024n),
  MiB:unit('storage',1048576n),
  GiB:unit('storage',1073741824n),
});

const gcd=(left,right)=>{let a=left<0n?-left:left,b=right<0n?-right:right;while(b){const next=a%b;a=b;b=next;}return a||1n;};

export function convertMetricUnit({value,sourceUnit,targetUnit}){
  const numeric=Number(value),source=String(sourceUnit??'').trim(),target=String(targetUnit??'').trim();
  if(!Number.isFinite(numeric)||!source||!target)return null;
  if(source===target)return{value:numeric,sourceValue:numeric,sourceUnit:source,targetUnit:target,conversionVersion:'identity-v1',conversionNumerator:1,conversionDenominator:1};
  const from=units[source],to=units[target];
  if(!from||!to||from.family!==to.family)return null;
  let numerator=from.numerator*to.denominator,denominator=from.denominator*to.numerator;const divisor=gcd(numerator,denominator);numerator/=divisor;denominator/=divisor;
  const converted=numeric*Number(numerator)/Number(denominator);
  if(!Number.isFinite(converted)||Math.abs(converted)>1e15)return null;
  return{value:converted,sourceValue:numeric,sourceUnit:source,targetUnit:target,conversionVersion:METRIC_UNIT_CONVERSION_VERSION,conversionNumerator:Number(numerator),conversionDenominator:Number(denominator)};
}

export function listMetricUnitFamilies(){return Object.entries(units).map(([name,item])=>({unit:name,family:item.family}));}
