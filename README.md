# Генератор фейк активности GitHub 

## Как юзать

1. Создаем ПРИВАТНУЮ репу Обязательно с файлом Readme
или клонируем мою
```
git clone https://github.com/KonstantNotFound/git-history.git
```

2. Устанавливаем зависимости
```
npm install jsonfile moment simple-git random lodash fs chalk inquirer yargs cli-progress terminal-kit
```

3. Юзаем с кайфом
```
node index.js
```

## Плюшки
1. Можно указать запуск сразу с конфигом:
```
node index.js --config ./config1.js/
```
2. Можно указывать свой текст коммитов: 
  Для этого есть файл **commits.txt** Параметр **uniqueness** отвечает за уникальность:
  0 - одна и та же строка может быть использована неограниченое кол-во раз, 1 - одна строка может быть использована только для 1 коммита.
