import {holdingProfile} from './holding';
/** Exact profile token validation: don't normalize a malformed source identifier. */
export function resolveProfileBinding(value:unknown, labels:{unit?:string;position?:string}={}) {
  const validNumber=typeof value==='number' && Number.isInteger(value) && value>=1 && value<=65;
  const validString=typeof value==='string' && /^(?:[1-9]|[1-5][0-9]|6[0-5])$/.test(value);
  if(!validNumber&&!validString)throw Error('Укажите номер профиля целым числом от 1 до 65');
  const row=holdingProfile(Number(value));
  if(!row)throw Error('Профиль не найден в исходном реестре Холдинга');
  if((labels.unit && labels.unit!==row.unit) || (labels.position && labels.position!==row.position))throw Error('Подразделение или должность не совпадают с исходным номером профиля');
  return {profileRow:row.profileRow,block:row.block,unit:row.unit,position:row.position,targetLevelModel:'В'};
}
