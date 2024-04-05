process.env["NTBA_FIX_350"] = 1;
require("dotenv").config();
const fs = require("node:fs");
const crypto = require("node:crypto");
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const { Image, registerFont } = require("canvas");
const TelegramBot = require('node-telegram-bot-api');
const cheerio = require("cheerio");

registerFont("./assets/Montserrat-Bold.ttf", { family: "Montserrat" });
const logoImage = new Image()
logoImage.src = "./assets/kryptexLogo.png";

const dataUpdateInterval = 15 * 60_000;

class Database extends Map {
	constructor() {
		super();

		try {
			JSON.parse(fs.readFileSync("./database.json", "utf-8")).forEach((data) => this.set(data.userId, data));
		} catch { }
	}

	set(key, value) {
		const exist = this.get(key);
		if (exist) Object.assign(exist, value);
		else super.set(key, { userId: key, ...value })

		this.save();
	}

	delete(key) {
		super.delete(key);
		this.save();
	}

	save() {
		fs.writeFileSync("./database.json", JSON.stringify([...this.values()]));
	}
}

const commands = {
	getBalance: "💳 Баланс",
	getMiners: "⛏ Майнеры",
	aboutCookies: "🍪 Зачем нужны куки?",
	setCookies: "🍪 Установить Cookie",
	deleteMe: "🗑️ Удалить меня",
	setPassword: "🔑 Обновить пароль",
	cancelCookies: "❌ Отменить установку Cookie",
	cancelPassword: "❌ Отменить установку пароля",
	cancelDeleteMe: "❌ Отменить удаление",
	deletePassword: "🗑️ Удалить пароль",
	confirmDeleteMe: "🗑️ Безвозвратно удалить меня",
	back: "↩️ Назад",
};

const bot = new TelegramBot(process.env.BotToken, { polling: true });
const database = new Database();

const defaultSendOptions = (user) => {
	let buttons = [[
		{ text: commands.getBalance },
		{ text: commands.getMiners },
	], [{ text: commands.deleteMe }, { text: commands.setPassword }, { text: commands.aboutCookies }]];
	if (!user?.cookie) buttons = [[{ text: commands.setCookies }, { text: commands.aboutCookies }]];

	return {
		disable_web_page_preview: true,
		parse_mode: 'Markdown',
		reply_markup: {
			resize_keyboard: true,
			keyboard: buttons,
		},
	};
};

const temp = new Map();

function saveCookie(id, cookie) {
	if (temp.get(`Cookie${id}`)) clearTimeout(temp.get(`Cookie${id}`).timeout);
	return temp.set(`Cookie${id}`, { cookie, timeout: setTimeout(() => temp.delete(`Cookie${message.from.id}`), 30 * 60 * 1_000) });
}

function getCookie(id) {
	return temp.get(`Cookie${id}`).cookie;
}

bot.on('message', async (message) => {
	const user = database.get(message.from.id);

	if (temp.has(`setCookie${message.from.id}`)) {
		const { state, messageId } = temp.get(`setCookie${message.from.id}`);

		if (state === 1) {
			saveCookie(message.from.id, message.text);

			bot.deleteMessage(message.chat.id, message.message_id).catch(() => null);
			bot.deleteMessage(message.chat.id, messageId).catch(() => null);

			return bot.sendMessage(message.chat.id, "Теперь отправьте пароль, с помощью которого будут зашифрованы куки. (Любая строка, содержащая любые символы. Желательно от 6 символов). *У Вас есть 30 минут на это!*", {
				parse_mode: "Markdown",
				reply_markup: {
					inline_keyboard: [[{ text: commands.cancelCookies, callback_data: "cancelCookies" }]],
				},
			}).then((msg) => temp.set(`setCookie${message.from.id}`, { state: 2, messageId: msg.message_id }));
		}

		if (state === 2) {
			await bot.deleteMessage(message.chat.id, message.message_id).catch(() => null);
			bot.deleteMessage(message.chat.id, messageId).catch(() => null);

			if (!temp.has(`Cookie${message.from.id}`)) return bot.sendMessage(message.chat.id, "Время вышло! Отправьте Cookie ещё раз.", {
				reply_markup: { inline_keyboard: [[{ text: commands.cancelCookies, callback_data: "cancelCookies" }]] },
			});

			try {
				const key = crypto.createHash("sha256").update(`${process.env.Secret}Xaliks${message.text}`).digest();
				const iv = crypto.randomBytes(16);

				const cipher = crypto.createCipheriv("aes-256-ctr", key, iv);

				const result = Buffer.concat([cipher.update(Buffer.from(temp.get(`Cookie${message.from.id}`).cookie)), cipher.final()]).toString("hex");
				temp.delete(`setCookie${message.from.id}`);

				database.set(message.from.id, { cookie: result, iv: iv.toString("hex") });

				return bot.sendMessage(message.chat.id, `Отлично! Я сохранил только \`${result}\` и iv: \`${iv.toString("hex")}\`.`, defaultSendOptions(database.get(message.from.id)));
			} catch (error) {
				console.error(error);

				return bot.sendMessage(message.chat.id, "Произошла какая-то ошибка при шифровании. Пожалуйста, попробуйте еще раз или сообщите об разработчику бота - @xaliksss.", {
					reply_markup: {
						inline_keyboard: [[{ text: commands.cancelCookies, callback_data: "cancelCookies" }]],
					},
				});
			}
		}
	}

	if (temp.has(`setPassword${message.from.id}`)) {
		await bot.deleteMessage(message.chat.id, message.message_id).catch(() => null);
		bot.deleteMessage(message.chat.id, temp.get(`setPassword${message.from.id}`)).catch(() => null);

		const decipher = crypto.createDecipheriv("aes-256-ctr", crypto.createHash("sha256").update(`${process.env.Secret}Xaliks${message.text}`).digest(), Buffer.from(user.iv, "hex"));
		const cookie = Buffer.concat([decipher.update(Buffer.from(user.cookie, "hex")), decipher.final()]).toString();

		saveCookie(message.from.id, cookie);
		temp.delete(`setPassword${message.from.id}`);

		return bot.sendMessage(message.chat.id, "Пароль сохранён! Через *30 минут* он снова удалится из кеша.", {
			...defaultSendOptions(user),
			reply_markup: {
				inline_keyboard: [[{ text: commands.deletePassword, callback_data: "deletePassword" }]],
			},
		});
	}

	if (message.text === "/start" || message.text === commands.back) {
		return bot.sendMessage(message.chat.id, `Привет! 👋
Я — *НЕОФИЦИАЛЬНЫЙ* бот [kryptex.com](https://www.kryptex.com/?ref=0f31ff65). Я помогу Вам отслеживать Ваши работающие майнеры, не заходя на сайт.

Чтобы начать использовать бота, Вам нужно отправить мне Cookie со страницы https://www.kryptex.com/site/dashboard.
⚠ Я храню Ваши данные *только в зашифрованном виде*, и Вы в любой момент можете их удалить.`, defaultSendOptions(user));
	}

	if (message.text === commands.aboutCookies) {
		return bot.sendMessage(message.chat.id, `🍪 Cookie — данные, используемые для авторизации на Криптексе. Без них бот не сможет работать.
	
Куки шифруются алгоритмом \`aes-256-ctr\`, ключ от него знаете *ТОЛЬКО ВЫ*.
Когда Вы отправляете ключ боту, бот хранит его в течение *30 минут* с последнего запроса, а затем он удаляется из памяти.
Плюс этого метода в том, что даже если каким-то образом, база данных бота утечёт в сеть, никто не сможет узнать ваши данные.
Главное - не делать слишком лёгкий пароль❗

*Что бот хранит обо мне?*
\`${JSON.stringify(user || "Пользователь не сохранён")}\` ¯\\\\_(ツ)\\_/¯`,
			defaultSendOptions(user));
	}

	if (message.text === commands.deleteMe) {
		if (!user) return bot.sendMessage(message.chat.id, "Вы уже удалены из базы данных!", defaultSendOptions(user));

		return bot.sendMessage(message.chat.id, "Вы действительно хотите удалить себя из бота? Ваш Cookie будет удалён!", {
			reply_markup: {
				inline_keyboard: [[{ text: commands.confirmDeleteMe, callback_data: "confirmDeleteMe" }], [{ text: commands.cancelDeleteMe, callback_data: "cancelDeleteMe" }]]
			}
		});
	}

	if (message.text === commands.setCookies) {
		return bot.sendPhoto(
			message.chat.id,
			"https://i.xaliks.dev/47b4d0d38e655dd21a0c9769ce1b9774.png",
			{
				caption: `Пожалуйста, отправьте мне Cookie со страницы https://www.kryptex.com/site/dashboard
\`Ctrl + Shift + I\` -> \`Network\` -> Обновить страницу (\`F5\`) -> В появившихся ссылках выбрать первую (\`www.kryptex.com\`) -> Справа пролистать до "Request Headers" и скопировать Cookie`,
				disable_web_page_preview: true,
				parse_mode: "Markdown",
				reply_markup: {
					inline_keyboard: [[{ text: commands.cancelCookies, callback_data: "cancelCookies" }]],
				},
			},
		).then((msg) => temp.set(`setCookie${message.from.id}`, { state: 1, messageId: msg.message_id }));
	}

	if (message.text === commands.setPassword) {
		return bot.sendMessage(message.chat.id, "Пожалуйста, отправьте пароль, который вы указывали, когда шифровали куки.", {
			reply_markup: {
				inline_keyboard: [[{ text: commands.cancelPassword, callback_data: "cancelPassword" }], [{ text: commands.deletePassword, callback_data: "deletePassword" }]],
			},
		}).then((msg) => temp.set(`setPassword${message.from.id}`, msg.message_id));
	}

	// Дальше идут команды, которые требуют куки

	if (Object.values(commands).includes(message.text)) {
		if (!user?.cookie) return bot.sendMessage(message.chat.id, "Вы не указали Cookie!", defaultSendOptions(user));

		const savedCookie = temp.get(`Cookie${message.from.id}`);
		if (!savedCookie) {
			return bot.sendMessage(message.chat.id, "*Время Вышло! Я больше не помню Ваш пароль!*\nПожалуйста, снова отправьте пароль, который вы указывали, когда шифровали куки.", {
				parse_mode: 'Markdown',
				reply_markup: {
					inline_keyboard: [[{ text: commands.cancelPassword, callback_data: "cancelPassword" }]],
				},
			}).then((msg) => temp.set(`setPassword${message.from.id}`, msg.message_id));
		};

		// refresh cookie timeout
		saveCookie(message.from.id, savedCookie.cookie);
	}

	if (temp.has(`selectMiner${message.from.id}`)) {
		const messageId = temp.get(`selectMiner${message.from.id}`);

		bot.deleteMessage(message.chat.id, messageId).catch(() => null);

		const msg = await bot.sendMessage(message.chat.id, "Получаю информацию...");
		const miner = await fetchMiner(message.text.split(" - ").at(-1), message.from.id).catch(console.error);
		bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => null);
		if (miner === 404) return bot.sendMessage(message.chat.id, "Майнер не найден!");
		if (miner === 403) {
			return bot.sendMessage(
				message.chat.id,
				`*Произошла ошибка при получении майнера!* Cookie истёк или пароль недействительный!
Нажмите на "*${commands.deleteMe}*", чтобы установить другой Cookie или на "*${commands.setPassword}*", чтобы указать пароль.`,
				defaultSendOptions(user));
		}
		if (!miner) return bot.sendMessage(message.chat.id, "Произошла ошибка при получении майнера!", defaultSendOptions(user));

		temp.delete(`selectMiner${message.from.id}`);

		const chartData = await fetchComputerHashrateChart(miner.id, message.from.id);
		const text = `${miner.online ? "🟢" : "🔴"} [${miner.name}](https://www.kryptex.com/site/hardware/${miner.id})
🔢 *Алгоритмы*: ${miner.algos.map((algo) => `\`${algo}\``).join(" / ")}
🌡 *Температура*: ${miner.temperature}
🔌*Энергопотребление*: ${miner.power}
					
🖥 *Информация*:
${miner.gpus.map((gpu) => `\`${gpu.name}\` | 🌡${gpu.temperature} | ⚡${gpu.power} | ${gpu.fan}`).join("\n")}
					
🔗 *Версия*: ${miner.version}
💻 *Операционная система*: ${miner.os}
🖥 *ОЗУ*: ${miner.ram}
🖥 *Процессор*: ${miner.cpu}`;

		if (!chartData) {
			return bot.sendMessage(message.chat.id, text, defaultSendOptions(user));
		}

		return bot.sendPhoto(
			message.chat.id,
			drawHashrateChart(chartData),
			{ ...defaultSendOptions(user), caption: text },
			{ filename: 'chart.png' },
		);
	}

	if (message.text === commands.getBalance) {
		const msg = await bot.sendMessage(message.chat.id, "Получаю информацию...");

		const balanceData = await fetchBalance(message.from.id).catch(console.error);
		bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => null);
		if (balanceData === 403) {
			return bot.sendMessage(
				message.chat.id,
				`*Произошла ошибка при получении баланса!* Cookie истёк или пароль недействительный!
Нажмите на "*${commands.deleteMe}*", чтобы установить другой Cookie или на "*${commands.setPassword}*", чтобы указать пароль.`,
				defaultSendOptions(user));
		}
		if (!balanceData) return bot.sendMessage(message.chat.id, "Произошла ошибка при получении баланса!", defaultSendOptions(user));

		return bot.sendPhoto(
			message.chat.id,
			drawBtcChart(balanceData.btcChart),
			{
				caption: `📦 *Баланс*: \`${balanceData.balance[0]}\` ${balanceData.balance[1]}
⌚ *Ожидает подтверждения*: \`${balanceData.waitingForConfirm[0]}\` ${balanceData.waitingForConfirm[1]}
💳 *Доступно для выплаты*: \`${balanceData.availableWithdrawal[0]}\` ${balanceData.availableWithdrawal[1]}
💵 *Доход за всё время*: \`${balanceData.allTimeEarnings[0]}\` ${balanceData.allTimeEarnings[1]}`,
				...defaultSendOptions(user),
			},
			{
				filename: 'chart.png',
			},
		);
	}

	if (message.text === commands.getMiners) {
		const msg = await bot.sendMessage(message.chat.id, "Получаю информацию...");

		const miners = await fetchMiners(message.from.id).catch(console.error);
		bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => null);
		if (miners === 403) {
			return bot.sendMessage(
				message.chat.id,
				`*Произошла ошибка при получении майнеров!* Cookie истёк или пароль недействительный!
Нажмите на "*${commands.deleteMe}*", чтобы установить другой Cookie или на "*${commands.setPassword}*", чтобы указать пароль.`,
				defaultSendOptions(user));
		}
		if (!miners) return bot.sendMessage(message.chat.id, "Произошла ошибка при получении майнеров!", defaultSendOptions(user));

		const replyOptions = defaultSendOptions(user);
		if (miners.length) {
			replyOptions.reply_markup = {
				resize_keyboard: true,
				keyboard: chunkArray(miners.map((miner) => {
					return { text: `${miner.is_online ? "🟢" : "🔴"} ${miner.name} - ${miner.hashid}` };
				}), 2).concat([[{ text: commands.back }]]),
			}
		}

		return bot.sendMessage(message.chat.id, `*Ваши майнеры (${miners.length}):*

${miners.map((miner) => {
			return `${miner.is_online ? "🟢" : "🔴"} [${miner.name}](https://www.kryptex.com/site/hardware/${miner.hashid}) - \`${miner.hardware.gpu_name}\` / \`${miner.hardware.cpu_name}\``
		}).join("\n") || "Пусто"}`, replyOptions).then((msg) => miners.length && temp.set(`selectMiner${message.from.id}`, msg.id));
	}
});

bot.on("callback_query", (query) => {
	if (query.data === "cancelCookies") {
		temp.delete(`setCookie${query.from.id}`);

		return bot.deleteMessage(query.message.chat.id, query.message.message_id).catch(() => null);
	}
	if (query.data === "cancelPassword" || query.data === "deletePassword") {
		temp.delete(`setPassword${query.from.id}`);

		if (query.data !== "cancelPassword") {
			const timeout = temp.get(`Cookie${query.from.id}`)?.timeout;
			if (timeout) {
				clearTimeout(timeout);
				temp.delete(`Cookie${query.from.id}`);
			}
		}

		return bot.deleteMessage(query.message.chat.id, query.message.message_id).catch(() => null);
	}
	if (query.data === "cancelDeleteMe") return bot.deleteMessage(query.message.chat.id, query.message.message_id).catch(() => null);
	if (query.data === "confirmDeleteMe") {
		database.delete(query.from.id);
		return bot.editMessageText("🗑️ Вы были успешно удалены из базы данных!", { chat_id: query.message.chat.id, message_id: query.message.message_id });
	}
})

bot.on("polling_error", console.error);

console.log("Bot started!");

async function fetchBalance(userId) {
	const $ = await request("/site/balance", getCookie(userId));
	if (typeof $ === "number") return $;

	const approx = $(".badge").toArray().map((element) => $(element).text());
	const values = $(".h2").toArray().map((element) => $(element).text());
	const [balance, waitingForConfirm, availableWithdrawal, allTimeEarnings] = [[values[0], approx[0]], [values[1], approx[1]], [values[2], approx[2]], [values[5], approx[4]]];
	const btcChart = Object.entries($("script:not([class])").toArray().map((element) => {
		const match = $(element).html().match(/window\.btcChartData = '(.*?)'/)?.[1];

		if (match) return JSON.parse(match.replaceAll("\\u0022", "\""))[0].data;
	}).filter(Boolean)[0]).map(([timestamp, value]) => [new Date(Number(timestamp)), Math.round(value)]);

	return { balance, waitingForConfirm, availableWithdrawal, allTimeEarnings, btcChart };
}

async function fetchMiners(userId) {
	const $ = await request("/site/hardware", getCookie(userId));
	if (typeof $ === "number") return $;

	const computersRaw = $("#computerDataset").text();
	if (!computersRaw) throw new Error("Failed to fetch computers");

	try {
		return JSON.parse(computersRaw);
	} catch {
		return [];
	}
}

async function fetchMiner(id, userId) {
	const $ = await request(`/site/hardware/${id}`, getCookie(userId));
	if (typeof $ === "number") return $;

	const name = $("h2").first().text();
	const [algos, temperature, power] = $(".info-card__status").toArray().map((element) => $(element).find("br").replaceWith("\n").end().text());
	const gpus = $("table tbody").find("tr").toArray().map((element) => $(element).find('td, th').toArray().map((element) => $(element).text().trim())).map((gpu) => {
		return { id: gpu[0], name: gpu[1], temperature: gpu[2], power: gpu[3], fan: gpu[4] };
	});
	const [version, os, ram, cpu] = $(".row ul").first().find("li").toArray().map((element) => $(element).text().trim().split("\n")[1].trim());
	const status = $(".text-success").length;

	return {
		id,
		online: Boolean(status),
		name,
		algos: algos.split("\n"),
		temperature,
		power,
		gpus,
		version,
		os,
		ram,
		cpu
	}
}

async function fetchComputerCharts(id, userId) {
	const $ = await request(`/site/hardware/${id}/charts`, getCookie(userId));
	if (typeof $ === "number") return $;

	const chartsRaw = $("#chart_data").text();
	if (!chartsRaw) throw new Error("Failed to fetch computers");

	return JSON.parse(chartsRaw);
}

async function fetchComputerHashrateChart(id, userId) {
	const $ = await request(`/site/hardware/${id}/hashrate`, getCookie(userId));
	if (typeof $ === "number") return $;

	const chartsRaw = $("#chart_data").text();
	if (!chartsRaw) throw new Error("Failed to fetch computers");

	return JSON.parse(chartsRaw);
}

async function request(endpoint, Cookie) {
	try {
		const response = await fetch(`https://www.kryptex.com${endpoint}`, { headers: { Cookie } });
		if ([403, 404].includes(response.status)) return response.status;
		if (!response.ok) return null;

		return response.text().then(cheerio.load);
	} catch {
		return 403;
	}
}

const chartPlugins = [{
	id: 'backgroundColor',
	beforeDraw: (chart, args, options) => {
		const { ctx } = chart;
		ctx.save();
		ctx.globalCompositeOperation = 'destination-over';
		ctx.fillStyle = options.color || '#99ffff';
		ctx.fillRect(0, 0, chart.width, chart.height);
		ctx.restore();
	}
}, {
	id: "drawTitle",
	beforeDraw: (chart, args, options) => {
		const { ctx, titleBlock: { _padding: { height } } } = chart;

		ctx.save();
		if (logoImage.complete) {
			const logoHeight = 40;
			const padding = 7;
			const logoWidth = logoHeight * (logoImage.width / logoImage.height);
			ctx.drawImage(logoImage, padding, (height - logoHeight) / 2, logoWidth, logoHeight);

			ctx.font = options.leftFont || "bold 32px Montserrat";
			ctx.fillStyle = "white";
			const leftTextHeight = ctx.measureText(options.leftText).actualBoundingBoxAscent;
			ctx.fillText(options.leftText, logoWidth + padding * 2, (leftTextHeight + height) / 2);

			if (options.rightText) {
				ctx.textAlign = "right";
				ctx.font = options.rightFont || "bold 32px Montserrat";
				const rightTextHeight = ctx.measureText(options.rightText).actualBoundingBoxAscent;
				ctx.fillText(options.rightText, chart.width - padding, (rightTextHeight + height) / 2);
			}

			ctx.textAlign = "center";
			ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
			ctx.font = "bold 40px Montserrat";
			const centerTextHeight = ctx.measureText("kryptex.com").actualBoundingBoxAscent;
			ctx.fillText("kryptex.com", chart.width / 2, (centerTextHeight + height) / 2);
		} else logoImage.onload = () => chart.draw();
		ctx.restore();
	}
}];

function drawBtcChart(data) {
	return new ChartJSNodeCanvas({ width: 1600, height: 700 }).renderToBufferSync({
		type: "line",
		data: {
			labels: data.map(([date]) => `${date.getDate()} ${["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"][date.getMonth()]}`),
			datasets: [{
				data: data.map(([, value]) => value),
				tension: 0.3,
				borderColor: 'rgba(82, 107, 192, 1)',
				pointRadius: 0,
				fill: true,
				backgroundColor: ({ chart }) => {
					const { ctx, chartArea } = chart;
					if (!chartArea) return;

					const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
					gradient.addColorStop(0, 'rgba(82, 107, 192, 0.5)');
					gradient.addColorStop(1, "transparent");

					return gradient;
				}
			}]
		},
		options: {
			backgroundColor: "#060B1E",
			responsive: true,
			scales: {
				x: {
					ticks: {
						color: "white",
						autoSkip: true,
						maxTicksLimit: 12,
						font: { family: "Montserrat", size: 15 },
						maxRotation: 0,
					},
					grid: { display: false },
				},
				y: {
					ticks: { color: "white", font: { family: "Montserrat", size: 15 } },
					grid: { color: "#16213F" },
				},
			},
			plugins: {
				backgroundColor: { color: "#060B1E" },
				legend: { display: false },
				title: { display: true, padding: 35, text: "" },
				drawTitle: { leftText: "Курс Биткоина", leftFont: "bold 32px Montserrat", rightText: `Цена: ${data.at(-1)[1].toLocaleString()}`, rightFont: "bold 25px Montserrat" },
			},
		},
		plugins: chartPlugins,
	}, "image/png");
}

function drawHashrateChart(data) {
	const usedAlgos = [];
	const algos = Object.keys(data.algos);
	const colors = {
		...algos.reduce((obj, algo) => ({ ...obj, [algo]: `#${Math.floor(Math.random() * 16777215).toString(16)}` }), {}),
		rvn: "#f4b87c",
		erg: "#bc80bd",
		iron: "#ffed6f",
		cfx: "#db99e8",
		zeph: "#7e1aff",
		xna: "#4ba93b",
		clore: "#1928ff",
		pyi: "#e2ff66",
		alph: "#44d8d8",
	};

	for (const hashrate of data.hashrate) {
		usedAlgos.push(...Object.entries(hashrate).filter(([key, value]) => algos.includes(key) && value > 0 && !usedAlgos.includes(key)).map(([algo]) => algo));
	}
	const realData = [];

	let lastTimestamp = 0;
	for (const hashrate of data.hashrate) {
		const data = [{
			date: new Date(hashrate.timestamp),
			...usedAlgos.reduce((obj, algo) => ({ ...obj, [algo]: hashrate[algo] }), {})
		}];

		// Заполняем пустые пространства в графике. Приложение обновляет статистику через каждые 15 минут, но когда он выключен, данных нет
		if (lastTimestamp) {
			const count = Math.floor((hashrate.timestamp - lastTimestamp) / dataUpdateInterval) - 1;
			if (count > 0) {
				new Array(count).fill(0).forEach((element, i) => data.unshift({
					date: new Date(lastTimestamp - i * dataUpdateInterval),
					...usedAlgos.reduce((obj, algo) => ({ ...obj, [algo]: 0 }), {})
				}))
			}
		}

		lastTimestamp = hashrate.timestamp;
		realData.push(...data);
	}

	return new ChartJSNodeCanvas({ width: 1600, height: 700 }).renderToBufferSync({
		type: "line",
		data: {
			labels: realData.map(({ date }) => `${date.getDate()} ${["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"][date.getMonth()]}`),
			datasets: usedAlgos.map((algo) => {
				return {
					label: `${data.algos[algo]} (${data.units[algo]})`,
					yAxisID: data.units[algo],
					data: realData.map((data) => data[algo]),
					tension: 0.35,
					backgroundColor: colors[algo] || Math.floor(Math.random() * 16777215).toString(16),
					borderColor: colors[algo] || Math.floor(Math.random() * 16777215).toString(16),
					pointRadius: 0,
				};
			}),
		},
		options: {
			backgroundColor: "#060B1E",
			responsive: true,
			scales: {
				x: {
					ticks: {
						color: "white",
						autoSkip: true,
						maxTicksLimit: 13,
						font: { family: "Montserrat", size: 15 },
						maxRotation: 0,
					},
					grid: { display: false },
				},
				["MH/s"]: {
					title: {
						display: true,
						color: "white",
						text: "MH/s",
						font: { family: "Montserrat", size: 15 },
					},
					position: "left",
					ticks: { color: "white", font: { family: "Montserrat", size: 15 } },
					grid: { color: "#16213F" },
				},
				["H/s"]: {
					title: {
						display: true,
						color: "white",
						text: "H/s",
						font: { family: "Montserrat", size: 15 },
					},
					position: "right",
					ticks: { color: "white", font: { family: "Montserrat", size: 15 } },
					grid: { color: "#16213F" },
				},
			},
			plugins: {
				backgroundColor: { color: "#060B1E" },
				legend: {
					position: "bottom",
					labels: {
						usePointStyle: true,
						color: "white",
						font: { family: "Montserrat", size: 15 }
					}
				},
				title: { display: true, padding: 35, text: "" },
				drawTitle: { leftText: "Хэшрейт", leftFont: "bold 32px Montserrat" },
			},
		},
		plugins: chartPlugins,
	}, "image/png");
}

function chunkArray(array, chunkSize) {
	const arr = [];
	for (let i = 0; i < array.length; i += chunkSize) arr.push(array.slice(i, i + chunkSize));
	return arr;
}

process.on("unhandledRejection", console.error);
