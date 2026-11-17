# -*- coding: utf-8 -*-
"""Import the customer forms without rewriting their Russian wording."""
import json, re, pathlib, zipfile, xml.etree.ElementTree as E
ROOT=pathlib.Path(__file__).resolve().parents[1]
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
def blocks(n):
    p=next(pathlib.Path.home().joinpath('Downloads').glob(f'Тест {n} - *.docx'))
    with zipfile.ZipFile(p) as z: body=E.fromstring(z.read('word/document.xml')).find(W+'body')
    out=[]
    for x in body:
        if x.tag==W+'p': out.append(''.join(x.itertext()) if False else ''.join(t.text or '' for t in x.iter(W+'t')))
        elif x.tag==W+'tbl':
            out.append([[ ''.join(t.text or '' for t in cell.iter(W+'t')) for cell in row.findall(W+'tc')] for row in x.findall(W+'tr')])
    return [x for x in out if x]
def loc(s): return {'ru':s,'kk':s}
old=json.loads((ROOT/'data/catalog.json').read_text('utf8'))
catalog=[]
def base(id,title,minutes,limit,algorithm):
    o=json.loads(json.dumps(next(x for x in old if x['id']==id)))
    o.update(version='2.0-2026-10-26',name=loc(title),durationMinutes=minutes,timeLimitSeconds=limit,algorithm=algorithm,questions=[],config={'items':{}},controlExamples=[],delivery={'practice':[],'shuffleOptions':id!='verbal'},source=f'Документы заказчика от 26.10.2026 — {title}',scientificBasis='Форма заказчика, предварительные пороги до пилота',licenseStatus='customer_materials',instructions=loc('Прочитайте инструкцию и выполните тренировку. Основной тест начинается отдельной кнопкой.'),limitations=loc('Методические материалы подготовлены для проверки.'))
    catalog.append(o);return o
def section(b,start,end):
    a=next(i for i,x in enumerate(b) if isinstance(x,str) and x.startswith(start));
    e=next((i for i in range(a+1,len(b)) if isinstance(b[i],str) and b[i].startswith(end)),len(b));return b[a+1:e]
def instruction(o,b):
    s=section(b,'3. Инструкция','4.') if o['id']!='situations' and o['id']!='motivation' else section(b,'4. Инструкция','5.')
    o['instructions']=loc('\n\n'.join(x for x in s if isinstance(x,str) and not x.startswith('Текст ')))
def q(o,num,text,options=None,material=None,type='single',control=None):
    id=f"{o['id']}-v2-{num}"
    result={'id':id,'type':type,'text':loc(text),'content':{},'options':[{'id':f'{id}-{chr(65+i)}','text':loc(t)} for i,t in enumerate(options or [])]}
    if material:result['content']['material']=loc(material)
    if control: result['content']['control']=control
    o['questions'].append(result);return result
def tabletext(t):return '\n'.join(' | '.join(row) for row in t)
def keytable(b,heading):return next(x for x in section(b,heading,str(int(heading[0])+1)+'.') if isinstance(x,list))
def practice(o,text,opts,correct,explanation,material=''):
    o['delivery']['practice'].append({'text':loc(text),'options':[loc(t) for t in opts],'correct':correct,'explanation':loc(explanation),'material':loc(material)})
# Verbal: automatic numbered lists in Word have no number in the text nodes.
b=blocks(1);o=base('verbal','Вербальный анализ',22,1320,'cognitive');instruction(o,b)
s=section(b,'5. Задания','6. Ключ');material='';num=0
for i,x in enumerate(s):
    if not isinstance(x,str):continue
    if re.match(r'Текст \d+\.',x):material=x+'\n\n'+s[i+1];continue
    if i and isinstance(s[i-1],str) and re.match(r'Текст \d+\.',s[i-1]):continue
    if not material:continue
    num+=1;q(o,num,x,['Верно','Неверно','Нельзя сказать'],material)
for row in keytable(b,'6. Ключ')[1:]:
    if row[0].isdigit():o['config']['items'][f'verbal-v2-{row[0]}']={'correct':f'verbal-v2-{row[0]}-{row[1]}'}
training=section(b,'4. Тренировочные','5. Задания');mat=training[0].removeprefix('Текст. ')
for i,x in enumerate(training):
    if isinstance(x,str) and re.match(r'П[12]\.',x):
        ans=training[i+1];practice(o,x.split(' A —')[0],['Верно','Неверно','Нельзя сказать'],ord(re.search(r'Ответ: ([ABC])',ans)[1])-65,ans,mat)
o['config']['bands']=[12,16,21,25,30]
# Numerical: retain original table values and context for each set.
b=blocks(2);o=base('numerical','Анализ числовой информации',25,1500,'cognitive');instruction(o,b)
s=section(b,'5. Задания','6. Ключ');material='';i=0
while i<len(s):
    x=s[i]
    if isinstance(x,str) and x.startswith('Набор '):
        context=[x];i+=1
        while i<len(s) and not (isinstance(s[i],str) and re.match(r'\d+\.',s[i])):
            context.append(tabletext(s[i]) if isinstance(s[i],list) else s[i]);i+=1
        material='\n\n'.join(context);continue
    if isinstance(x,str) and (m:=re.match(r'(\d+)\. (.+)',x)):
        opt=re.split(r'\s*[A-E]\)\s*',s[i+1])[1:];q(o,m[1],m[2],opt,material);i+=2;continue
    i+=1
for row in keytable(b,'6. Ключ')[1:]:
    if row[0].isdigit():o['config']['items'][f'numerical-v2-{row[0]}']={'correct':f'numerical-v2-{row[0]}-{row[1]}'}
training=section(b,'4. Тренировочные','5. Задания');mat=tabletext(next(x for x in training if isinstance(x,list)))
for i,x in enumerate(training):
    if isinstance(x,str) and re.match(r'П[12]\.',x):
        opts=re.split(r'\s*[A-E]\)\s*',training[i+1])[1:];ans=training[i+2];practice(o,x,opts,ord(re.search(r'Верный ответ: ([A-E])',ans)[1])-65,ans,mat)
o['config']['bands']=[5,8,12,15,18]
# Personality: original scoring key, revised wording, six controls outside scoring.
b=blocks(4);o=base('personality','Личностные характеристики',25,1500,'scales')
o['instructions']=loc('Оцените, насколько каждое утверждение описывает вас в обычной жизни и работе. 1 — совсем не про меня; 2 — скорее не про меня; 3 — отчасти про меня; 4 — скорее про меня; 5 — точно про меня. Правильных и неправильных ответов нет. Лимит — 25 минут. Ответы сохраняются автоматически.')
o['delivery']['scaleLabels']=[loc(x) for x in ['Совсем не про меня','Скорее не про меня','Отчасти про меня','Скорее про меня','Точно про меня']]
source=next(x for x in old if x['id']=='personality');o['config']={'min':1,'max':5,'scales':source['config']['scales'],'items':{},'quality':'personality'}
original_ipip=json.loads((ROOT/'data/sources/ipip/en.json').read_text('utf-8-sig'))
items=next(x for x in section(b,'4. Пункты','5. Ключ') if isinstance(x,list)) if any(isinstance(x,str) and x.startswith('4. Пункты') for x in b) else next(x for x in b if isinstance(x,list) and len(x)>120)
for row in items[1:]:
    no=row[0].replace('*','').strip()
    if no.isdigit():
        item=q(o,no,row[1],type='scale');key=original_ipip[int(no)-1];o['config']['items'][item['id']]={'reverse':key['keyed']=='minus','scales':[key['domain'],key['domain']+str(key['facet'])]}
    elif re.match('[КK][1-6]',no):
        item=q(o,no,row[1],type='scale',control=no);o['config']['items'][item['id']]={'control':no}
o['config']['invertScales']=['N','N3']
o['config']['scales']['N']['name']=loc('Эмоциональная устойчивость');o['config']['scales']['N3']['name']=loc('Устойчивость настроения')
# Motivation: twelve four-item scales and a separate top/bottom card selection.
b=blocks(5);o=base('motivation','Мотивационный профиль',12,720,'scales');instruction(o,b)
o['config']={'min':1,'max':5,'scales':{},'items':{},'quality':'motivation'}
o['delivery']['scaleLabels']=[loc(x) for x in ['Заметно снижает','Немного снижает','Не влияет','Немного повышает','Заметно повышает']]
items=next(x for x in section(b,'5. Пункты','6. Часть') if isinstance(x,list))
for row in items[1:]:q(o,row[0],row[1],type='scale')
for row in keytable(b,'7. Ключ')[1:]:
    code,name=[x.strip() for x in row[0].split('·',1)];o['config']['scales'][code]={'name':loc(name),'min':1,'max':5}
    for n,r in re.findall(r'(\d+)(R?)',row[1]):o['config']['items'][f'motivation-v2-{n}']={'scales':[code],'reverse':bool(r)}
cards=next(x for x in section(b,'6. Часть','7. Ключ') if isinstance(x,list))
rank=q(o,'priorities','Выберите 3 наиболее важных и 3 наименее важных фактора.',type='ranking')
rank['options']=[{'id':row[1],'text':loc(row[0])} for row in cards[1:]];o['config']['items'][rank['id']]={'ranking':True}
# SJT: fourteen new cases; source letters are mapped to stable option IDs.
b=blocks(6);o=base('situations','Управленческие ситуации',30,1800,'sjt');instruction(o,b)
s=section(b,'6. Кейсы','7. Предварительный') if any(isinstance(x,str) and x.startswith('6. Кейсы') for x in b) else section(b,'6. Задания','7. Предварительный')
i=0
while i<len(s):
    if isinstance(s[i],str) and (m:=re.match(r'Кейс (\d+)\. (.+)',s[i])):
        text=s[i]+'\n\n'+s[i+1];opts=[re.sub(r'^[A-D]\.\s*','',v) for v in s[i+2:i+6]];q(o,m[1],text,opts,type='sjt');i+=6
    else:i+=1
competencies=next(x for x in section(b,'3. Компетенции','4. Инструкция') if isinstance(x,list))
for row in keytable(b,'7. Предварительный')[1:]:
    if row[0].isdigit():
        id=f'situations-v2-{row[0]}';o['config']['items'][id]={'most':f'{id}-{row[1]}','least':f'{id}-{row[2]}','competency':loc(competencies[int(row[0])][3])}
training=section(b,'5. Тренировочный','6.');strings=[x for x in training if isinstance(x,str)]
opts=[re.sub(r'^[A-D]\.\s*','',x) for x in strings if re.match(r'^[A-D]\.',x)]
if len(opts)==4:
    before=strings[:next(i for i,x in enumerate(strings) if re.match(r'^A\.',x))];after=strings[next(i for i,x in enumerate(strings) if re.match(r'^D\.',x))+1:]
    o['delivery']['practice']=[{'text':loc('\n\n'.join(before)),'options':[loc(x) for x in opts],'type':'sjt','explanation':loc('\n\n'.join(after))}]
o['config']['bands']=[12,16,20,24,28]
# OMIB is built by the companion script from the original item table.
for o in catalog:
    expected={'verbal':30,'numerical':18,'personality':126,'motivation':49,'situations':14}[o['id']]
    assert len(o['questions'])==expected,(o['id'],len(o['questions']))
    assert len(o['config']['items'])==expected,(o['id'],'keys',len(o['config']['items']))
    assert all(len(x['text']['ru'])>1 for x in o['questions'])
(ROOT/'data/new-forms.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2),'utf8')
print([(x['id'],len(x['questions']),len(x['delivery']['practice'])) for x in catalog])
