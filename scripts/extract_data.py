import zipfile
import xml.etree.ElementTree as ET
import glob
import re
import json
from datetime import datetime, timedelta

NS = {
    'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
}

def clean_phone(raw):
    if raw is None:
        return ""
    # Could be float in scientific notation, string, int
    s = str(raw).strip()
    if 'E' in s or 'e' in s:
        try:
            val = float(s)
            s = f"{val:.0f}"
        except:
            pass
    elif '.' in s:
        try:
            val = float(s)
            s = f"{val:.0f}"
        except:
            pass
    # Keep only digits
    digits = re.sub(r'\D', '', s)
    # Check if starts with repeated 55
    if digits.startswith('5555') and len(digits) >= 14:
        digits = digits[2:]
    # Remove leading 55 if present to store canonical DDD + number
    if digits.startswith('55') and len(digits) in (12, 13):
        digits = digits[2:]
    return digits

def excel_date_to_iso(val):
    if not val:
        return datetime.now().isoformat()
    try:
        fval = float(val)
        # Excel epoch is 1899-12-30 (due to 1900 leap year bug)
        dt = datetime(1899, 12, 30) + timedelta(days=fval)
        return dt.isoformat()
    except:
        return datetime.now().isoformat()

def normalize_turma(turma, segment):
    if not turma:
        return ""
    t = turma.strip().upper()
    t = re.sub(r'\s+', ' ', t)
    # Fundamental: 6º-1 -> 6º 1
    if segment == "FUNDAMENTAL":
        t = t.replace('6º-1', '6º 1').replace('6º - 1', '6º 1')
    # Médio: 2ºADM -> 2º ADM, 3ºADM -> 3º ADM, 1º ADM
    elif segment == "MEDIO":
        t = t.replace('1ºADM', '1º ADM').replace('2ºADM', '2º ADM').replace('3ºADM', '3º ADM')
    # Noturno: 1º SÉRIE -> 1º Série, etc.
    elif segment == "NOTURNO":
        if '1' in t: t = '1º Série'
        elif '2' in t: t = '2º Série'
        elif '3' in t: t = '3º Série'
    return t

def clean_name(name):
    if not name:
        return ""
    s = name.strip()
    # Remove trailing emojis/checkmarks like ✅
    s = re.sub(r'[\u2700-\u27bf\u2600-\u26ff\u2190-\u21ff\U00010000-\U0010ffff]', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s.upper()

def extract_workbook(filepath, segment):
    print(f"Reading {filepath} ({segment})...")
    with zipfile.ZipFile(filepath, 'r') as z:
        ss = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('main:si', NS):
                ss.append(''.join([t.text or '' for t in si.findall('.//main:t', NS)]))
        wb = ET.fromstring(z.read('xl/workbook.xml'))
        rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}

        sheets_data = {}
        for sheet in wb.findall('.//main:sheet', NS):
            sheet_name = sheet.attrib['name']
            rid = sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
            target = 'xl/' + rels[rid].lstrip('/')
            if target not in z.namelist():
                continue
            ws = ET.fromstring(z.read(target))
            rows = []
            for r_elem in ws.findall('.//main:sheetData/main:row', NS):
                row_dict = {}
                for c in r_elem.findall('main:c', NS):
                    ref = c.attrib.get('r', '')
                    col = re.sub(r'\d+', '', ref)
                    t = c.attrib.get('t')
                    v = c.find('main:v', NS)
                    is_el = c.find('main:is', NS)
                    val = None
                    if v is not None and v.text is not None:
                        val = ss[int(v.text)] if t == 's' else v.text
                    elif is_el is not None:
                        val = ''.join([x.text or '' for x in is_el.findall('.//main:t', NS)])
                    if val is not None:
                        row_dict[col] = val
                if row_dict:
                    rows.append(row_dict)
            sheets_data[sheet_name] = rows

    # 1. Extract Students from DADOS
    students = []
    dados_rows = sheets_data.get('DADOS', [])
    for row in dados_rows[1:]: # skip header
        turma = row.get('A')
        nome = row.get('B')
        resp = row.get('C', '')
        contato = row.get('D', '')
        if nome and nome.strip() and turma and turma.strip():
            c_name = clean_name(nome)
            c_turma = normalize_turma(turma, segment)
            c_phone = clean_phone(contato)
            students.append({
                'name': c_name,
                'turma': c_turma,
                'guardian': resp.strip() if resp else "",
                'phone': c_phone,
                'segment': segment
            })

    # 2. Extract Templates from MENSAGENS
    templates = []
    msg_rows = sheets_data.get('MENSAGENS', [])
    for row in msg_rows[1:]:
        motivo = row.get('B')
        antes = row.get('C', '')
        depois = row.get('D', '')
        if motivo and motivo.strip() and motivo.strip().upper() != 'MOTIVO DA FALTA':
            templates.append({
                'title': motivo.strip(),
                'prefix': antes.strip(),
                'suffix': depois.strip(),
                'segment': segment
            })

    # 3. Extract Logs from LOG_ENVIOS
    logs = []
    log_rows = sheets_data.get('LOG_ENVIOS', [])
    for row in log_rows[1:]:
        dt_val = row.get('A')
        aluno = row.get('B')
        motivo = row.get('C')
        pedagoga = row.get('D')
        retornou = row.get('E')
        if aluno and aluno.strip() and motivo:
            # normalize pedagoga name
            ped = pedagoga.strip() if pedagoga else "Equipe Pedagógica"
            if ped == "Jaque": ped = "Jaqueline Lopes"
            elif ped == "Nathaly": ped = "Nathaly R."
            logs.append({
                'date': excel_date_to_iso(dt_val),
                'student_name': clean_name(aluno),
                'reason': motivo.strip(),
                'pedagoga': ped,
                'returned': bool(retornou and retornou.strip()),
                'segment': segment
            })

    # 4. Extract Low attendance if present
    low_att = []
    low_rows = sheets_data.get('ALUNOS COM PERCENTUAL BAIXO DE ', [])
    for row in low_rows[1:]:
        aluno = row.get('A')
        turma = row.get('B')
        freq = row.get('C')
        detalhe = row.get('D', '')
        acoes = row.get('E', '')
        if aluno and aluno.strip():
            try:
                freq_f = float(freq)
                if freq_f <= 1.0: freq_f = freq_f * 100.0
            except:
                freq_f = 0.0
            low_att.append({
                'student_name': clean_name(aluno),
                'turma': normalize_turma(turma, segment),
                'attendance_percent': round(freq_f, 2),
                'enrollment_detail': detalhe.strip() if detalhe else "",
                'actions_taken': acoes.strip() if acoes else "",
                'segment': segment
            })

    return {
        'students': students,
        'templates': templates,
        'logs': logs,
        'low_attendance': low_att
    }

def main():
    fund = extract_workbook('BUSCA ATIVA  FUNDAMENTAL - COLÉGIO LEOPOLDINA - 2026.xlsx', 'FUNDAMENTAL')
    medio = extract_workbook('BUSCA ATIVA  MÉDIO - COLÉGIO LEOPOLDINA - 2026.xlsx', 'MEDIO')
    noturno = extract_workbook('BUSCA ATIVA  NOTURNO - COLÉGIO LEOPOLDINA - 2026.xlsx', 'NOTURNO')

    all_data = {
        'FUNDAMENTAL': fund,
        'MEDIO': medio,
        'NOTURNO': noturno
    }

    with open('scripts/extracted_data.json', 'w', encoding='utf-8') as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)

    total_students = len(fund['students']) + len(medio['students']) + len(noturno['students'])
    total_logs = len(fund['logs']) + len(medio['logs']) + len(noturno['logs'])
    print(f"Extracted {total_students} students and {total_logs} logs successfully into scripts/extracted_data.json!")

if __name__ == '__main__':
    main()
