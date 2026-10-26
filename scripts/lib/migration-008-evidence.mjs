// Offline reconciliation only. No connection, environment variables, SQL execution or business IO.
import { createHash } from 'node:crypto';
export const MIGRATION_008_SHA256='30df860f6ba51617e93c55be21e8d2355aba734977dfb3db6bf0776b5c07c160';
const normalize=(text)=>text.replaceAll(' USING btree','').replaceAll('::text','').replace(/[\s();]/g,'').toLowerCase();
export function compare008Evidence({ sql, ledger, schema, privileges, ownership }) {
  const checks={};
  const check=(name,ok)=>{checks[name]=Boolean(ok);};
  check('artifact_sha256',createHash('sha256').update(sql).digest('hex')===MIGRATION_008_SHA256);
  const entry=ledger.find(r=>r.version==='008');
  check('ledger_008',entry?.filename==='008_costs_financial_scopes_and_open_corrections.sql' && entry.checksum_sha256===MIGRATION_008_SHA256);
  check('ledger_versions',JSON.stringify(ledger.map(r=>r.version))===JSON.stringify(Array.from({length:8},(_,i)=>String(i+1).padStart(3,'0'))));
  for(const [,table,body] of sql.matchAll(/CREATE TABLE app\.(\w+) \(\n([\s\S]*?)\n\);/g)){
    const expected={};
    for(const line of body.split('\n')){
      const m=/^  ([a-z_]+) (uuid|text|timestamptz|bigint)\b(.*)/.exec(line);
      if(m)expected[m[1]]={udt:m[2]==='bigint'?'int8':m[2],nullable:/NOT NULL|PRIMARY KEY/.test(m[3])?'NO':'YES',default:m[3].includes('DEFAULT gen_random_uuid()')?'gen_random_uuid()':m[3].includes('DEFAULT now()')?'now()':null};
    }
    const actual=Object.fromEntries(schema.tables.filter(c=>c.table===table).map(c=>[c.column,{udt:c.udt,nullable:c.nullable,default:c.default}]));
    check(`columns_${table}`,JSON.stringify(expected)===JSON.stringify(actual));
  }
  for(const [table,col,udt,nullable,def] of [
    ['cost_concepts','financial_scope_id','uuid','YES',null],['cost_event_types','financial_scope_id','uuid','YES',null],['expenses','details_version','int8','NO','0'],
    ...['expense_payments','expense_allocations'].flatMap(t=>[['created_correction_id','uuid'],['retired_correction_id','uuid'],['retired_at','timestamptz'],['retired_by_user_id','uuid']].map(([c,type])=>[t,c,type,'YES',null])),
  ]){
    const c=schema.tables.find(c=>c.table===table && c.column===col);
    check(`column_${table}_${col}`,c?.udt===udt && c.nullable===nullable && c.default===def);
  }
  // This bounded parser is for the hash-pinned artifact, not a general SQL interpreter.
  for(const m of sql.matchAll(/\bCONSTRAINT (\w+) (CHECK|UNIQUE|FOREIGN KEY)\b/g)){
    const begin=m.index+m[0].indexOf(m[2]);let end=begin,depth=0;
    for(;end<sql.length;end++){
      const c=sql[end];
      if(c==='(')depth++;
      else if(c===')'){if(depth===0)break;depth--;}
      else if((c===','||c===';')&&depth===0)break;
    }
    const actual=schema.constraints.find(c=>c.name===m[1]);
    check(`constraint_${m[1]}`,actual && normalize(actual.definition)===normalize(sql.slice(begin,end)));
  }
  check('old_allocation_unique_absent',!schema.constraints.some(c=>c.name==='uq_expense_allocation_party'));
  for(const m of sql.matchAll(/CREATE (?:UNIQUE )?INDEX (\w+)\s+ON [\s\S]*?;/g)){
    const actual=schema.indexes.find(i=>i.name===m[1]);
    check(`index_${m[1]}`,actual && normalize(actual.definition)===normalize(m[0]));
  }
  const sourceBody=sql.split('AS $guard$')[1]?.split('$guard$;')[0]?.trim();
  const actualBody=schema.function?.split('AS $function$')[1]?.split('$function$')[0]?.trim();
  check('function_body_exact',Boolean(sourceBody) && sourceBody===actualBody);
  const fn=privileges.guard_function;
  check('function_security',fn.security_definer===false && fn.public_execute===false && fn.group_execute===true && fn.login_execute===true && JSON.stringify(fn.config)===JSON.stringify(['search_path=pg_catalog, app']));
  const triggers=[...sql.matchAll(/CREATE TRIGGER [\s\S]*?;/g)].map(m=>m[0].replace(/\s+/g,' ').replace(/;$/,''));
  check('triggers',JSON.stringify(triggers.sort())===JSON.stringify([...schema.triggers].sort()));
  for(const role of privileges.roles){
    check(`role_${role.name}`,['super','createdb','createrole','replication','bypassrls','create_app','create_audit'].every(k=>role[k]===false)
      && role.login===(role.name==='app_horas_runtime') && (role.name!=='app_horas_runtime'||role.inherit===true));
  }
  check('ownership',ownership.length===2 && ownership.every(r=>r.owns_canonical===false));
  check('memberships',JSON.stringify(privileges.memberships)===JSON.stringify([{member:'app_horas_runtime',role:'app_runtime'}]) || JSON.stringify(privileges.memberships)===JSON.stringify([{role:'app_runtime',member:'app_horas_runtime'}]));
  check('privilege_row_coverage',privileges.privileges.length===26 && new Set(privileges.privileges.map(r=>`${r.role}:${r.table}`)).size===26);
  for(const row of privileges.privileges){
    const authority=['app.cost_financial_scopes','app.cost_financial_authorities','app.cost_financial_authority_revocations'].includes(row.table);
    const columns=['app.expense_payments','app.expense_allocations'].includes(row.table)?['retired_correction_id','retired_at','retired_by_user_id']:[];
    check(`privilege_${row.role}_${row.table}`,row.select===true && row.insert===!authority && ['update','delete','truncate','references','trigger'].every(k=>row[k]===false) && JSON.stringify(row.update_columns)===JSON.stringify(columns));
  }
  check('public_acl',!privileges.public_table_acl?.length && !privileges.public_column_acl?.length);
  return {checks,failures:Object.keys(checks).filter(k=>!checks[k])};
}
