from pathlib import Path
import tomllib,json,shutil,sys
root=Path('resources'); agents=root/'agents'; skills=root/'skills'; agents.mkdir(parents=True,exist_ok=True); skills.mkdir(exist_ok=True)
src=Path(sys.argv[1]); catalog=[]
for path in sorted((src/'categories').rglob('*.toml')):
    d=tomllib.loads(path.read_text(encoding='utf-8')); ident=path.stem
    if 'developer_instructions' not in d: continue
    # Bundled copies deliberately omit upstream model, effort and sandbox defaults.
    text='\n'.join(line for line in path.read_text(encoding='utf-8').splitlines() if not line.startswith(('model =','model_reasoning_effort =','sandbox_mode =')))+'\n'
    (agents/path.name).write_text(text,encoding='utf-8')
    catalog.append({'id':ident,'name':d.get('name',ident),'description':d.get('description',''),'category':path.parent.name,'instructions':d['developer_instructions'],'source':'https://github.com/VoltAgent/awesome-codex-subagents/blob/main/'+path.relative_to(src).as_posix()})
shutil.copyfile(src/'LICENSE',agents/'LICENSE')
selection={'crew-planning':'multi-agent-coordinator','crew-research':'research-analyst','crew-frontend':'frontend-developer','crew-backend':'backend-developer','crew-debugging':'debugger','crew-review':'code-reviewer','crew-testing':'test-automator','crew-security':'security-auditor'}
metadata=[]
for name,ident in selection.items():
    item=next(a for a in catalog if a['id']==ident); folder=skills/name; folder.mkdir(exist_ok=True)
    desc=item['description'].replace('Use when','Apply when')
    body='---\nname: '+name+'\ndescription: '+json.dumps(desc)+'\n---\n\n# '+name.replace('-',' ').title()+'\n\n'+item['instructions'].strip()+'\n\nFollow the current task and role permissions. This skill does not grant permission to edit, delegate, install tools or contact external services. Keep PixelCrew model and reasoning settings.\n\nAdapted from [VoltAgent '+ident+']('+item['source']+'), MIT License. See [LICENSE](../LICENSE).\n'
    (folder/'SKILL.md').write_text(body,encoding='utf-8');metadata.append({'id':name,'name':name,'description':desc,'source':item['source'],'file':'skills/'+name+'/SKILL.md'})
shutil.copyfile(src/'LICENSE',skills/'LICENSE')
(root/'catalog.json').write_text(json.dumps({'agents':catalog,'skills':metadata},ensure_ascii=False,indent=2),encoding='utf-8')
(root/'NOTICE.md').write_text('# Bundled VoltAgent material\n\nAgent profiles and adapted crew skills are based on [VoltAgent/awesome-codex-subagents](https://github.com/VoltAgent/awesome-codex-subagents), Copyright (c) 2026 VoltAgent, MIT License. License copies are included in agents/LICENSE and skills/LICENSE.\n\nModifications: upstream model, reasoning and sandbox defaults are removed from bundled profile files. Runtime always uses PixelCrew profiles. Skills are adapted from selected agent instructions, rather than copied from the separate third-party skills link catalog.\n',encoding='utf-8')
print(f'Bundled {len(catalog)} agent profiles and {len(metadata)} usable skill packages.')
