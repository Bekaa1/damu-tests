import { beforeEach, describe, expect, it, vi } from 'vitest';
const f=vi.hoisted(()=>({session:vi.fn(),user:vi.fn(),member:vi.fn(),org:vi.fn()}));
vi.mock('../apps/api/src/db',()=>({db:{user:{findUniqueOrThrow:f.user},membership:{findFirst:f.member},organization:{findUnique:f.org}}}));
vi.mock('../apps/api/src/auth',()=>({auth:{api:{getSession:f.session}}}));
vi.mock('../packages/core/pilot',()=>({hasCurrentConsent:()=>true}));
import {AccessGuard,requireRole} from '../apps/api/src/access';
const real={id:'real',dataMode:'real',purpose:'assessment',status:'active'},demo={id:'demo',dataMode:'synthetic',purpose:'assessment',status:'active'};
function setup(role='admin',demoOnly=true,platformAdmin=false){
 const user={id:'account',demoOnly,platformAdmin,mustChangePassword:false};const members=[{id:'old',userId:'account',organizationId:'real',organization:real,role,status:'active',createdAt:new Date('2026-11-01')},{id:'new',userId:'account',organizationId:'demo',organization:demo,role,status:'active',createdAt:new Date()}];
 f.session.mockResolvedValue({user:{id:'account'},session:{id:'session'}});f.user.mockResolvedValue(user);f.member.mockImplementation(async({where}:any)=>members.find(m=>m.userId===where.userId&&m.status===where.status&&(!where.organizationId||m.organizationId===where.organizationId)&&(!where.organization?.dataMode||m.organization.dataMode===where.organization.dataMode))??null);f.org.mockImplementation(async({where}:any)=>[real,demo].find(o=>o.id===where.id)??null);return{members,user};
}
const run=(selected?:string)=>{const req:any={method:'GET',path:'/api/me',headers:selected?{'x-organization-id':selected}:{}};return{req,check:()=>new AccessGuard().canActivate({switchToHttp:()=>({getRequest:()=>req})}as any)}};
beforeEach(()=>vi.clearAllMocks());
describe('client demo membership routing',()=>{
 it.each(['admin','expert','employee'])('defaults restricted %s to synthetic membership without altering legacy membership',async role=>{const{members}=setup(role);const before=structuredClone(members),{req,check}=run();expect(await check()).toBe(true);expect(req.ctx.org.id).toBe('demo');expect(req.ctx.member.id).toBe('new');expect(req.ctx.role).toBe(role);expect(members).toEqual(before);expect(f.org).toHaveBeenCalledWith({where:{id:'demo'}});});
 it.each([false,true])('rejects a forged real tenant even with platformAdmin=%s',async platform=>{setup('admin',true,platform);const{check}=run('real');await expect(check()).rejects.toThrow();expect(f.org).not.toHaveBeenCalled();});
 it('normalizes restricted platform-admin flag to actual demo expert role',async()=>{setup('expert',true,true);const{req,check}=run();expect(await check()).toBe(true);expect(req.ctx.role).toBe('expert');expect(()=>requireRole(req.ctx,'admin')).toThrow();expect(()=>requireRole(req.ctx,'superadmin')).toThrow();});
 it('allows explicit permitted synthetic tenant',async()=>{setup();const{req,check}=run('demo');expect(await check()).toBe(true);expect(req.ctx.org.id).toBe('demo');});
 it('fails closed if no synthetic membership exists',async()=>{const{members}=setup();members.pop();await expect(run().check()).rejects.toThrow();expect(f.org).not.toHaveBeenCalled();});
 it('does not give access to an inactive synthetic membership',async()=>{const{members}=setup();members[1].status='blocked';await expect(run().check()).rejects.toThrow();});
 it('preserves ordinary real-user default selection',async()=>{setup('admin',false);const{req,check}=run();expect(await check()).toBe(true);expect(req.ctx.org.id).toBe('real');expect(f.member.mock.calls[0][0].where.organization).toBeUndefined();});
 it('preserves genuine platform admin selection',async()=>{setup('admin',false,true);const{req,check}=run('real');expect(await check()).toBe(true);expect(req.ctx.role).toBe('superadmin');});
 it('does not authenticate an absent session',async()=>{setup();f.session.mockResolvedValue(null);await expect(run().check()).rejects.toThrow(/Войдите/);expect(f.user).not.toHaveBeenCalled();});
});
