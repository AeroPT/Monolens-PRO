# 📸 MonoLens Pro V11

> A lente definitiva para fotografia monocromática profissional no seu Android.

**MonoLens Pro** é uma aplicação de câmera de alta performance focada exclusivamente na arte da fotografia em Preto e Branco. Desenvolvida para fotógrafos que exigem controle total sobre a luminância, a app oferece ferramentas de gradação de nível em tempo real que antes só estavam disponíveis em softwares de pós-processamento.

---

## ✨ Funcionalidades Principais

### 🌑 Controle de Luminância em Tempo Real
Ao contrário de filtros comuns, o MonoLens Pro processa a imagem através de um pipeline de hardware acelerado:
- **Levels (Níveis):** Ajuste os pontos de preto e branco (Input Levels) antes mesmo de disparar.
- **Gamma Control:** Ajuste os tons médios para criar atmosferas dramáticas ou suaves.
- **Contrast Pro:** Algoritmo de contraste pivotado para preservar detalhes nas sombras e altas luzes.

### 📈 Ferramentas de Precisão
- **Curvas de Tom (Curves):** Interface baseada em Spline Cúbica Monotônica para controle total da curva de contraste.
- **Histograma Vivo:** Monitorize a exposição e evite "clipping" (perda de detalhe) com feedback visual instantâneo.
- **Foco Manual (Manual Focus):** Controle preciso da distância focal via slider dedicado quando o foco está travado.

### 🔍 Gestão de Lentes Avançada
- Suporte nativo para sistemas de múltiplas câmeras (Ultra Wide, Telephoto, Macro).
- **Custom Lens Names:** Identifique e renomeie suas lentes (Ex: "35mm Street", "Wide Landscape") pressionando longamente as pílulas de seleção.
- **Exposure Reset:** Pressione longamente o valor de EV para resetar instantaneamente para zero.

---

## 🛠️ Stack Tecnológica

- **Core:** React 19 + TypeScript
- **Estilização:** Tailwind CSS (Design Minimalista e Imersivo)
- **Engine de Imagem:** SVG Filters + Canvas API (Pipeline de baixa latência)
- **Persistência:** IndexedDB (Armazenamento local de alta capacidade para fotos)
- **Mobile Bridge:** Capacitor 6 (Interface nativa Android)
- **Ícones:** Lucide React

---

## 🚀 Guia de Build (Android)

Para transformar este projeto web em uma aplicação `.apk` funcional:

### 1. Compilação do Código Web
No terminal do projeto, execute:
```bash
npm install
npm run build
npx cap sync android
```

### 2. Configuração no Android Studio
Abra a pasta `android` no Android Studio.

#### 📸 Permissões (AndroidManifest.xml)
Certifique-se de que `android/app/src/main/AndroidManifest.xml` contém:
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="true" />
```

---

## 📱 Dicas de Fotografia Profissional

- **Compensação de Exposição (EV):** Deslize verticalmente em qualquer lugar do visor para ajustar o brilho. Em cenas com muito céu, abaixe o EV para -0.7 para capturar detalhes dramáticos nas nuvens.
- **ISO Manual:** Use ISO baixo (100-200) para nitidez máxima. ISOs altos adicionam um "grão" digital que pode ser esteticamente interessante em P&B.
- **Curva de Tons:** Uma curva em "S" suave é o segredo para o look clássico de filme analógico de alto contraste.
- **Trava de Foco:** Toque no objeto principal para focar. Se estiver em modo AF-S (amarelo), use o slider lateral para micro-ajustes de nitidez.

---
*Desenvolvido com ❤️ por MonoLens Pro Team.*