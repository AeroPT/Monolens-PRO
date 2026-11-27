
# 📸 MonoLens Pro

> The definitive lens for professional monochromatic photography on Android.

**MonoLens Pro** is a high-performance camera application focused exclusively on the art of Black & White photography. Built with web technologies and bridged to native Android, it offers real-time luminance grading tools previously only found in post-processing software.

## ✨ Key Features

### 🌑 Real-Time Luminance Control
Unlike standard filters, MonoLens Pro processes the image through a hardware-accelerated pipeline:
- **Levels:** Adjust Input Black and White points before capturing.
- **Gamma Control:** Fine-tune mid-tones for dramatic or soft atmospheres.
- **Contrast Pro:** Pivoted contrast algorithms to preserve details in shadows and highlights.

### 📈 Precision Tools
- **Tone Curves:** Monotone Cubic Spline interface for total contrast curve control.
- **Live Histogram:** Monitor exposure and avoid clipping with instant visual feedback.
- **Manual Focus:** Precise focal distance slider (when supported by hardware).
- **ISO & Exposure:** Manual overrides for complete creative control.

### 🔍 Advanced Lens Management
- Native support for multi-camera systems (Ultra Wide, Telephoto, Macro).
- Seamless switching between available hardware lenses.

### 🖼️ Integrated Gallery
- High-performance gallery with pinch-to-zoom and pan gestures.
- Save directly to device storage or share via system dialogs.

---

## 💻 Tech Stack

- **Core:** [React 19](https://react.dev/) + TypeScript
- **Build Tool:** [Vite](https://vitejs.dev/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Image Engine:** SVG Filters + Canvas API (Low-latency pipeline)
- **Mobile Bridge:** [Capacitor 6](https://capacitorjs.com/) (Native Android Interface)
- **Icons:** Lucide React

---

## 🛠️ Prerequisites & Dependencies

To run and build this project on **Windows**, you will need the following installed:

1.  **Node.js**: (LTS version recommended). [Download here](https://nodejs.org/).
2.  **Git**: For cloning the repository. [Download here](https://git-scm.com/).
3.  **Android Studio** (For building the Android App):
    *   Required to compile the final `.apk`.
    *   Include the **Android SDK** and **Android Virtual Device** during installation.
    *   [Download Android Studio](https://developer.android.com/studio).

---

## 🚀 Installation Guide (Windows)

### 1. Clone the Repository
Open your Command Prompt (cmd) or PowerShell and run:

```bash
git clone https://github.com/your-username/monolens-pro.git
cd monolens-pro
```

### 2. Install Project Dependencies
Install the required Node packages:

```bash
npm install
```

### 3. Run Development Server (Web Mode)
To test the UI logic in your browser:

```bash
npm run dev
```
*   Open `http://localhost:3000` in your browser.
*   *Note: Native features like the Status Bar, Haptics, and saving to the filesystem will not work in the browser. A webcam is required for the camera feed.*

---

## 📱 Building for Android

To run the full application on an Android device or Emulator:

### 1. Build the Web Assets
Compile the React code into static files:

```bash
npm run build
```

### 2. Sync with Capacitor
This copies your web build into the native Android project folder:

```bash
npx cap sync android
```

### 3. Open in Android Studio
Launch the native project:

```bash
npx cap open android
```

### 4. Run on Device
1.  Connect your Android phone to your PC via USB.
2.  Enable **USB Debugging** on your phone (Settings > Developer Options).
3.  In Android Studio, select your device from the dropdown menu in the top toolbar.
4.  Click the green **Play (▶)** button.

---

## 📂 Project Structure

```
monolens-pro/
├── android/            # Native Android project files
├── src/
│   ├── components/     # UI Components (Camera, Gallery, Controls)
│   ├── hooks/          # Custom React Hooks (useCamera)
│   ├── utils/          # Image processing logic & Storage
│   ├── App.tsx         # Main entry point
│   └── index.tsx       # DOM mounting
├── public/             # Static assets
└── dist/               # Compiled build output
```

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

*Developed with ❤️ by the MonoLens Pro Team.*
