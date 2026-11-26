import os
import subprocess
import sys

def run(cmd):
    print(f"\n> {cmd}")
    result = subprocess.run(cmd, shell=True)
    if result.returncode != 0:
        print("Erro ao executar comando")
        sys.exit(1)

def exists(path):
    return os.path.exists(path)

print("Preparação de app Vite para Android com Capacitor\n")

print("Tipo de operação")
print("1 Novo projeto Android")
print("2 Atualização de código web\n")

choice = input("Escolhe 1 ou 2: ").strip()

if choice not in ("1", "2"):
    print("Opção inválida")
    sys.exit(1)

if choice == "1":
    print("\nNovo projeto selecionado\n")

    app_name = input("Nome da aplicação: ").strip()
    while not app_name:
        app_name = input("Nome não pode estar vazio: ").strip()

    default_id = "com.example." + app_name.lower().replace(" ", "")
    app_id = input(f"Package ID [{default_id}]: ").strip()
    if not app_id:
        app_id = default_id

    print("\nA instalar dependências...\n")

    run("npm install @capacitor/core @capacitor/cli")
    run("npm install @capacitor/android")

    if not exists("capacitor.config.ts"):
        run(f'npx cap init "{app_name}" "{app_id}" --web-dir=dist')

    run("npm run build")

    if not exists("android"):
        run("npx cap add android")

    print("\nProjeto Android criado com sucesso")

else:
    print("\nAtualização selecionada\n")

    if not exists("android"):
        print("Projeto Android não existe. Usa a opção Novo projeto")
        sys.exit(1)

    run("npm run build")
    run("npx cap sync ")
    run("npx cap open android")

    print("\nCódigo web sincronizado com Android")

print("\nOperação concluída")
print("Pasta android pronta para uso no Android Studio")
