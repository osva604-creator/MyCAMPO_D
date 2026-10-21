import { openDB } from 'idb';

// One connection per database. An older tab must release its connection when a
// newer version upgrades; failed opens must remain retryable.
const connections=new Map();
export function openLocalDb(name,version,upgrade) {
  if(connections.has(name))return connections.get(name);
  let opened;
  const reset=()=>{if(connections.get(name)===opened)connections.delete(name);};
  opened=openDB(name,version,{upgrade,blocking(){void opened.then(db=>db.close());reset();},terminated:reset}).catch(error=>{reset();throw error;});
  connections.set(name,opened);return opened;
}
export const scopeRange=scope=>IDBKeyRange.bound(`${scope}:`,`${scope}:\uffff`);
export async function matchingRows(db,store,predicate) {
  const result=[];
  for(let cursor=await db.transaction(store).store.openCursor();cursor;cursor=await cursor.continue())if(predicate(cursor.value))result.push(cursor.value);
  return result;
}
