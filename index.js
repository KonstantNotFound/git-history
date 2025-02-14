import jsonfile from "jsonfile";
import moment from "moment";
import simpleGit from "simple-git";
import random from "random";
import _ from "lodash";
import fs from "fs";
import chalk from "chalk";
import inquirer from "inquirer";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import ProgressBar from "cli-progress";
import terminalKit from "terminal-kit";

const { terminal } = terminalKit;
console.clear();

// Конфигурация стилей
const theme = {
  title: chalk.hex('#6A5ACD').bold,
  success: chalk.hex('#32CD32'),
  error: chalk.hex('#FF4500'),
  warning: chalk.hex('#FFD700'),
  info: chalk.hex('#00BFFF'),
  highlight: chalk.hex('#FF69B4'),
  progress: chalk.hex('#9370DB')
};

// Символы для оформления
const symbols = {
  ok: '✓',
  error: '✗',
  warn: '⚠',
  progress: '»',
  arrow: '➤',
  dot: '◈',
  line: '─',
  corner: '╰'
};

// Дефолтные настройки
const defaultSettings = {
  datelimit: ["2020-01-01", "2020-01-31"],
  commitlimit: [0, 10],
  skipDaysPerMonth: [4, 10],
  commitstext: { dir: "commits.txt", uniqueness: 0.7 },
  skipDates: [],
  ignoreDays: {
    Воскресенье: 90,
    Понедельник: 10,
    Вторник: 5,
    Среда: 5,
    Четверг: 10,
    Пятница: 20,
    Суббота: 80
  }
};

// Текущие настройки сессии
let currentSettings;

// Парсинг аргументов
const argv = yargs(hideBin(process.argv))
  .option('config', {
    type: 'string',
    describe: 'Путь к конфигурационному файлу',
    default: ''
  })
  .option('datelimit-start', {
    type: 'string',
    describe: 'Дата начала (ГГГГ-ММ-ДД)'
  })
  .option('datelimit-end', {
    type: 'string',
    describe: 'Дата окончания (ГГГГ-ММ-ДД)'
  })
  .option('commitlimit-min', {
    type: 'number',
    describe: 'Минимальное количество коммитов в день'
  })
  .option('commitlimit-max', {
    type: 'number',
    describe: 'Максимальное количество коммитов в день'
  })
  .option('skip-days-min', {
    type: 'number',
    describe: 'Минимум пропусков дней в месяце'
  })
  .option('skip-days-max', {
    type: 'number',
    describe: 'Максимум пропусков дней в месяце'
  })
  .option('commits-text-file', {
    type: 'string',
    describe: 'Путь к файлу с сообщениями коммитов'
  })
  .option('uniqueness', {
    type: 'number',
    describe: 'Уникальность сообщений (0-1)'
  })
  .option('skip-dates', {
    type: 'string',
    describe: 'Даты для пропуска в формате JSON-массива'
  })
  .option('ignore-days', {
    type: 'string',
    describe: 'Дни недели для пропуска в формате JSON-объекта'
  })
  .version('1.0.0')
  .help()
  .argv;

// Функции оформления
const printHeader = (text) => {
  terminal.clear();
  const title = ` ${text} `;
  const width = terminal.width;
  const padding = Math.floor((width - title.length) / 2);
  
  console.log(
    theme.title(
      ' '.repeat(padding) + 
      `╭${symbols.line.repeat(title.length)}╮\n` +
      ' '.repeat(padding) + 
      `│${title}│\n` +
      ' '.repeat(padding) + 
      `╰${symbols.line.repeat(title.length)}╯`
    )
  );
};

const loadConfig = async () => {
  try {
    if (argv.config) {
      const configModule = await import(argv.config);
      currentSettings = _.merge({}, defaultSettings, configModule.default || configModule);
    } else {
      currentSettings = _.cloneDeep(defaultSettings);
    }
  } catch (error) {
    console.error(theme.error(` ${symbols.error} Ошибка загрузки конфига: ${error.message}`));
    process.exit(1);
  }
};

const applyArguments = () => {
  const mappings = {
    "datelimitStart": ["datelimit", 0],
    "datelimitEnd": ["datelimit", 1],
    "commitlimitMin": ["commitlimit", 0],
    "commitlimitMax": ["commitlimit", 1],
    "skipDaysMin": ["skipDaysPerMonth", 0],
    "skipDaysMax": ["skipDaysPerMonth", 1],
    "commitsTextFile": ["commitstext", "dir"],
    "uniqueness": ["commitstext", "uniqueness"]
  };

  Object.entries(mappings).forEach(([arg, [setting, index]]) => {
    if (argv[arg] !== undefined) {
      _.set(currentSettings, setting, index === 0 ? 
        [argv[arg], currentSettings[setting][1]] : 
        [currentSettings[setting][0], argv[arg]]
      );
    }
  });

  try {
    if (argv.skipDates) {
      currentSettings.skipDates = JSON.parse(argv.skipDates);
    }
    if (argv.ignoreDays) {
      currentSettings.ignoreDays = JSON.parse(argv.ignoreDays);
    }
  } catch (error) {
    console.error(theme.error(` ${symbols.error} Ошибка парсинга JSON: ${error.message}`));
    process.exit(1);
  }
};

// Валидация настроек
const validateSettings = () => {
  const errors = [];
  
  const [startDate, endDate] = currentSettings.datelimit.map(d => moment(d, "YYYY-MM-DD"));
  if (!startDate.isValid() || !endDate.isValid()) {
    errors.push("Неверный формат даты (используйте ГГГГ-ММ-ДД)");
  }
  if (startDate.isAfter(endDate)) {
    errors.push("Дата начала должна быть раньше даты окончания");
  }

  if (currentSettings.commitlimit.some(n => n < 0)) {
    errors.push("Количество коммитов не может быть отрицательным");
  }
  if (currentSettings.commitlimit[0] > currentSettings.commitlimit[1]) {
    errors.push("Минимум коммитов не может превышать максимум");
  }

  if (currentSettings.commitstext.uniqueness < 0 || currentSettings.commitstext.uniqueness > 1) {
    errors.push("Уникальность должна быть в диапазоне от 0 до 1");
  }

  const daysOfWeek = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  const ignoreDaysKeys = Object.keys(currentSettings.ignoreDays);
  if (!ignoreDaysKeys.every(key => daysOfWeek.includes(key))) {
    errors.push("Некорректные дни недели в ignoreDays");
  }

  return errors;
};

const editSettingsInteractive = async () => {
  const editOptions = [
    { name: '1. Дата начала', value: 'datelimitStart' },
    { name: '2. Дата окончания', value: 'datelimitEnd' },
    { name: '3. Мин. коммитов в день', value: 'commitlimitMin' },
    { name: '4. Макс. коммитов в день', value: 'commitlimitMax' },
    { name: '5. Мин. пропусков дн/мес', value: 'skipDaysMin' },
    { name: '6. Макс. пропусков дн/мес', value: 'skipDaysMax' },
    { name: '7. Файл сообщений', value: 'commitsTextFile' },
    { name: '8. Уникальность', value: 'uniqueness' },
    { name: '9. Фиксированные пропуски', value: 'skipDates' },
    { name: '10. Шансы пропуска дней недели', value: 'ignoreDays' },
    { name: '11. Завершить редактирование', value: 'exit' }
  ];

  while (true) {
    const { action } = await inquirer.prompt({
      type: 'list',
      name: 'action',
      message: 'Выберите параметр для изменения:',
      choices: editOptions,
      pageSize: 12
    });

    if (action === 'exit') break;

    try {
      switch (action) {
        case 'datelimitStart':
          const { newStartDate } = await inquirer.prompt({
            type: 'input',
            name: 'newStartDate',
            message: 'Новая дата начала (ГГГГ-ММ-ДД):',
            default: currentSettings.datelimit[0],
            validate: input => moment(input, 'YYYY-MM-DD').isValid() || 'Неверный формат даты!'
          });
          currentSettings.datelimit[0] = newStartDate;
          break;

        case 'datelimitEnd':
          const { newEndDate } = await inquirer.prompt({
            type: 'input',
            name: 'newEndDate',
            message: 'Новая дата окончания (ГГГГ-ММ-ДД):',
            default: currentSettings.datelimit[1],
            validate: input => moment(input, 'YYYY-MM-DD').isValid() || 'Неверный формат даты!'
          });
          currentSettings.datelimit[1] = newEndDate;
          break;

        case 'commitlimitMin':
          const { newMin } = await inquirer.prompt({
            type: 'number',
            name: 'newMin',
            message: 'Новый минимум коммитов:',
            default: currentSettings.commitlimit[0],
            validate: input => input >= 0 || 'Значение не может быть отрицательным!'
          });
          currentSettings.commitlimit[0] = newMin;
          break;

        case 'commitlimitMax':
          const { newMax } = await inquirer.prompt({
            type: 'number',
            name: 'newMax',
            message: 'Новый максимум коммитов:',
            default: currentSettings.commitlimit[1],
            validate: input => input >= currentSettings.commitlimit[0] || 'Должно быть больше или равно минимуму!'
          });
          currentSettings.commitlimit[1] = newMax;
          break;

        case 'skipDaysMin':
          const { newSkipMin } = await inquirer.prompt({
            type: 'number',
            name: 'newSkipMin',
            message: 'Новый минимум пропусков:',
            default: currentSettings.skipDaysPerMonth[0],
            validate: input => input >= 0 || 'Значение не может быть отрицательным!'
          });
          currentSettings.skipDaysPerMonth[0] = newSkipMin;
          break;

        case 'skipDaysMax':
          const { newSkipMax } = await inquirer.prompt({
            type: 'number',
            name: 'newSkipMax',
            message: 'Новый максимум пропусков:',
            default: currentSettings.skipDaysPerMonth[1],
            validate: input => input >= currentSettings.skipDaysPerMonth[0] || 'Должно быть больше или равно минимуму!'
          });
          currentSettings.skipDaysPerMonth[1] = newSkipMax;
          break;

        case 'commitsTextFile':
          const { newPath } = await inquirer.prompt({
            type: 'input',
            name: 'newPath',
            message: 'Новый путь к файлу сообщений:',
            default: currentSettings.commitstext.dir
          });
          currentSettings.commitstext.dir = newPath;
          break;

        case 'uniqueness':
          const { newUniq } = await inquirer.prompt({
            type: 'number',
            name: 'newUniq',
            message: 'Новая уникальность (0-1):',
            default: currentSettings.commitstext.uniqueness,
            validate: input => input >= 0 && input <= 1 || 'Должно быть между 0 и 1!'
          });
          currentSettings.commitstext.uniqueness = newUniq;
          break;

        case 'skipDates':
          const { newSkipDates } = await inquirer.prompt({
            type: 'input',
            name: 'newSkipDates',
            message: 'Новые пропускаемые даты (JSON-массив):',
            default: JSON.stringify(currentSettings.skipDates),
            validate: input => {
              try {
                JSON.parse(input);
                return true;
              } catch {
                return 'Неверный JSON формат!';
              }
            }
          });
          currentSettings.skipDates = JSON.parse(newSkipDates);
          break;

        case 'ignoreDays':
          const { newIgnoreDays } = await inquirer.prompt({
            type: 'input',
            name: 'newIgnoreDays',
            message: 'Новые шансы пропуска (JSON-объект):',
            default: JSON.stringify(currentSettings.ignoreDays),
            validate: input => {
              try {
                JSON.parse(input);
                return true;
              } catch {
                return 'Неверный JSON формат!';
              }
            }
          });
          currentSettings.ignoreDays = JSON.parse(newIgnoreDays);
          break;
      }

      console.log(theme.success(`\n ${symbols.ok} Параметр успешно изменен!`));
      await showSettingsDashboard();
	  break
    } catch (error) {
      console.log(theme.error(` ${symbols.error} Ошибка: ${error.message}`));
    }
  }
};

// Отображение настроек
const showSettingsDashboard = async () => {
  let confirm;
  do {
    printHeader('ТЕКУЩИЕ НАСТРОЙКИ');

    const displayData = [
      `${theme.info(symbols.dot)} Диапазон дат: ${theme.highlight(currentSettings.datelimit.join(" — "))}`,
      `${theme.info(symbols.dot)} Коммитов в день: ${theme.highlight(currentSettings.commitlimit.join(" - "))}`,
      `${theme.info(symbols.dot)} Пропусков дней/месяц: ${theme.highlight(currentSettings.skipDaysPerMonth.join(" - "))}`,
      `${theme.info(symbols.dot)} Файл сообщений: ${theme.highlight(currentSettings.commitstext.dir || "авто-генерация")}`,
      `${theme.info(symbols.dot)} Уникальность: ${theme.highlight(Math.round(currentSettings.commitstext.uniqueness * 100) + "%")}`,
      `${theme.info(symbols.dot)} Фиксированные пропуски: ${theme.highlight(currentSettings.skipDates.join(", ") || "нет")}`,
      `${theme.info(symbols.dot)} Шанс пропуска дней: ${theme.highlight(
        Object.entries(currentSettings.ignoreDays)
          .map(([day, chance]) => `${day.slice(0,3)}: ${chance}%`)
          .join(" | ")
      )}`
    ];

    displayData.forEach(line => console.log(`  ${line}`));

    const { action } = await inquirer.prompt({
      type: 'list',
      name: 'action',
      message: '\n\nВыберите действие:',
      choices: [
        { name: '1. Начать генерацию', value: 'start' },
        { name: '2. Изменить параметры', value: 'edit' },
        { name: '3. Выход', value: 'cancel' }
      ],
      pageSize: 3
    });

    if (action === 'edit') {
      await editSettingsInteractive();
    } else {
      confirm = action === 'start';
      break;
    }
  } while (true);

  return confirm;
};

class CommitGenerator {
  constructor() {
    this.git = simpleGit();
    this.commitFilePath = "./data.json";
    this.bar = new ProgressBar.Bar({
      format: `${theme.progress('{bar}')} ${theme.info('{percentage}%')} | ${theme.highlight('Всего: {value}/{total}')} | ${theme.warning('Обрабатывается: {day}')}`,
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true
    });
  }

  async initialize() {
    this.daysArray = this.generateDateArray();
    this.skippedDays = this.calculateSkippedDays();
    this.commitMessages = await this.loadCommitMessages();
  }

  generateDateArray() {
    const [start, end] = currentSettings.datelimit.map(d => moment(d));
    const days = [];
    let current = start.clone();
    
    while (current.isSameOrBefore(end)) {
      days.push(current.format("YYYY-MM-DD"));
      current.add(1, "day");
    }
    return days;
  }

  calculateSkippedDays() {
    const grouped = _.groupBy(this.daysArray, d => moment(d).format("YYYY-MM"));
    return new Set(
      Object.values(grouped).flatMap(days => 
        _.sampleSize(days, random.int(...currentSettings.skipDaysPerMonth))
    ));
  }

  async loadCommitMessages() {
    if (!currentSettings.commitstext.dir) return null;

    try {
      const content = fs.readFileSync(currentSettings.commitstext.dir, "utf-8");
      const lines = content.split("\n").filter(l => l.trim());
      if (!lines.length) throw new Error("Файл пуст");
      
      return {
        messages: lines,
        used: new Set(),
        uniqueness: currentSettings.commitstext.uniqueness
      };
    } catch (error) {
      const { useDefault } = await inquirer.prompt({
        type: "confirm",
        name: "useDefault",
        message: " Файл с сообщениями не найден. Использовать авто-генерацию?",
        default: true,
        prefix: theme.warning(symbols.warn)
      });
      
      return useDefault ? null : process.exit(0);
    }
  }

  getCommitMessage() {
    if (!this.commitMessages) {
      return `chore: update ${Math.random().toString(36).substring(2,7)}`;
    }

    const { messages, used, uniqueness } = this.commitMessages;
    const available = messages.filter(m => !used.has(m));

    if (available.length === 0 || Math.random() > uniqueness) {
      used.clear();
    }

    const message = _.sample(available);
    used.add(message);
    return message;
  }

  async processDay(day) {
    if (currentSettings.skipDates.includes(day)) return "fixed_skip";
    
    const weekday = moment(day).format('dddd');
    if (random.int(1, 100) <= currentSettings.ignoreDays[weekday]) return "chance_skip";
    
    if (this.skippedDays.has(day)) return "monthly_skip";

    const commitCount = random.int(...currentSettings.commitlimit);
    await this.createCommits(day, commitCount);
    return commitCount;
  }

  async createCommits(day, count) {
    const dateISO = moment(day).set({ hour: 12 }).toISOString();
    
    for (let i = 0; i < count; i++) {
      const data = { date: day, value: Math.random() };
      jsonfile.writeFileSync(this.commitFilePath, data);
      
      await this.git
        .env({ GIT_COMMITTER_DATE: dateISO, GIT_AUTHOR_DATE: dateISO })
        .add(this.commitFilePath)
        .commit(this.getCommitMessage(), { "--date": dateISO });
    }
  }

  async run() {
    printHeader('ГЕНЕРАЦИЯ КОММИТОВ');
    this.bar.start(this.daysArray.length, 0);

    const stats = {
      totalCommits: 0,
      skippedDays: 0,
      types: {
        fixed_skip: 0,
        chance_skip: 0,
        monthly_skip: 0
      }
    };

    for (let i = 0; i < this.daysArray.length; i++) {
      const day = this.daysArray[i];
      const percent = ((i + 1) / this.daysArray.length) * 100;
      this.bar.update(i + 1, { day });

      const result = await this.processDay(day);

      if (typeof result === "number") {
        stats.totalCommits += result;
      } else {
        stats.skippedDays++;
        stats.types[result]++;
      }
      this.bar.update(i + 1);
    }

    this.bar.stop();
    this.showSummary(stats);
    await this.handlePush();
  }

  showSummary(stats) {
    printHeader('РЕЗУЛЬТАТЫ');
    
    const summary = [
      `${theme.info(symbols.dot)} Всего дней:      ${theme.highlight(this.daysArray.length)}`,
      `${theme.success(symbols.ok)} Создано коммитов: ${theme.highlight(stats.totalCommits)}`,
      `${theme.warning(symbols.warn)} Пропущено дней:  ${theme.highlight(stats.skippedDays)}`,
      `\n${theme.info('Детали пропусков:')}`,
      `${theme.info(symbols.arrow)} Фиксированные:  ${theme.highlight(stats.types.fixed_skip)}`,
      `${theme.info(symbols.arrow)} По дням в месяц:  ${theme.highlight(stats.types.monthly_skip)}`,
      `${theme.info(symbols.arrow)} По дням недели:  ${theme.highlight(stats.types.chance_skip)}`
    ];

    summary.forEach(line => console.log(`  ${line}`));
  }

  async handlePush() {
    const { push } = await inquirer.prompt({
      type: "confirm",
      name: "push",
      message: " Отправить коммиты?",
      default: true,
      prefix: theme.info(symbols.arrow)
    });

    if (push) {
      console.log(theme.info(`\n ${symbols.progress} Отправка коммитов...`));
      await this.git.push();
      console.log(theme.success(`${symbols.ok} Коммиты успешно отправлены!`));
    } else {
      console.log(theme.warning(`\n ${symbols.warn} Операция отменена пользователем`));
	  return;
    }
  }
}

// Основной процесс
const main = async () => {
  try {
    await loadConfig();
    applyArguments();
    
    printHeader('ГЕНЕРАТОР GIT КОММИТОВ');

    const errors = validateSettings();
    if (errors.length > 0) {
      printHeader('ОШИБКИ КОНФИГУРАЦИИ');
      errors.forEach(e => console.log(theme.error(` ${symbols.error} ${e}`)));
      process.exit(1);
    }

    if (!await showSettingsDashboard()) {
      console.log(theme.warning(`\n ${symbols.warn} Операция отменена пользователем`));
      return;
    }

    const generator = new CommitGenerator();
    await generator.initialize();
    await generator.run();

  } catch (error) {
    printHeader('КРИТИЧЕСКАЯ ОШИБКА');
    console.log(theme.error(` ${symbols.error} ${error.message}`));
    process.exit(1);
  }
};

main();