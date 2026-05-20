# Информационный стенд

Веб-приложение для информационного стенда (телевизор в коридоре).
Два экрана: плейлист фото/видео + панель управления.

## Структура проекта

```
stend/
├── html/
│   ├── index.html      # Экран стенда (показывается на телевизоре)
│   └── admin.html      # Панель управления
├── backend/
│   └── server.js       # Node.js API сервер
├── nginx.conf          # Конфиг nginx
├── Dockerfile          # Образ для бэкенда
├── docker-compose.yml  # Запуск всего проекта
└── README.md
```

## Установка на сервер

### 1. Установить Docker (если не установлен)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
```

### 2. Скопировать проект на сервер

С вашего компьютера:
```bash
scp -r ./stend user@IP_СЕРВЕРА:~/
```

Или через git, если используете репозиторий:
```bash
git clone <ваш-репозиторий> ~/stend
```

### 3. Запустить

```bash
cd ~/stend
docker compose up -d --build
```

## Адреса

| Страница | URL |
|---|---|
| Стенд (телевизор) | `http://IP_СЕРВЕРА/` |
| Панель управления | `http://IP_СЕРВЕРА/admin.html` |

## Управление

```bash
# Запустить
docker compose up -d --build

# Остановить
docker compose down

# Перезапустить
docker compose restart

# Логи
docker compose logs -f

# Обновить HTML без перезапуска
# (просто замените файлы в папке html/ — изменения применяются сразу)
```

## Возможности

- Загрузка фото (JPG, PNG, GIF, WebP) и видео (MP4, WebM, MOV)
- Настройка длительности показа для каждого фото
- Перетаскивание для изменения порядка
- Автоматическое обновление плейлиста на экране стенда каждые 15 секунд
- Видео воспроизводится полностью, затем переключается следующий элемент
- Часы и дата на экране стенда
разрешить включение звука - chrome://settings/content/sound
