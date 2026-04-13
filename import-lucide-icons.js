// Script para importar automaticamente todos os ícones do lucide-react usados em Admin.tsx
// Uso: node import-lucide-icons.js

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'artifacts', 'ka-imports', 'src', 'pages', 'Admin.tsx');

const code = fs.readFileSync(FILE, 'utf8');

// Regex para encontrar componentes com letra maiúscula (ex: <Truck />, <UserPlus />)
const matches = [...code.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].map(m => m[1]);

// Lista de nomes únicos
const unique = Array.from(new Set(matches));

// Lista de ícones já importados
const importLine = code.match(/import \{([^}]+)\} from "lucide-react";/);
const already = importLine ? importLine[1].split(',').map(s => s.trim()) : [];

// Ícones que faltam importar
const missing = unique.filter(name => !already.includes(name));

// Nova linha de importação
const allIcons = Array.from(new Set([...already, ...missing])).sort();
const newImport = `import { ${allIcons.join(', ')} } from "lucide-react";`;

// Substitui a linha antiga pela nova
const newCode = importLine
  ? code.replace(importLine[0], newImport)
  : newImport + '\n' + code;

fs.writeFileSync(FILE, newCode, 'utf8');

console.log('Importação de ícones do lucide-react atualizada!');
