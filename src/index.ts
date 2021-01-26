import FileLoader from './fileLoader.js';

interface Request {
  vkId: number;
  sourceId?: number;
  code: string;
  createdTime: number;
}

export default class ReqPlugin {
  henta: any;
  fileLoader = new FileLoader(this);
  tags = {};
  requests: Set<Request>;

  constructor(henta) {
    this.henta = henta;
    this.fileLoader.setHenta(henta);
  }

  init(henta) {
    const botPlugin = henta.getPlugin('common/bot');
    botPlugin.setHandler('requests', this.handler.bind(this));

    const usersPlugin = henta.getPlugin('common/users');
    usersPlugin.group('req')
      .method('new', (self, data, source) => {
        const code = this.getFreeCode();
        const createdTime = Math.floor(Date.now() / 1000);
        if (source) {
          data.sourceId = source.vkId;
        }

        data.peers = [data.peer || source.vkid];
        this.requests.add({ vkId: self.vkId, code, createdTime, ...data });

        self.sendBuilder()
          .lines([
            `📬 ${data.text} (${code})`,
            `\n💡 Вы можете ответить на это сообщение символом +/- чтобы принять или отклонить эту заявку. (${code})`
          ])
          .attach(data.attachments)
          .kebord([
            { label: 'Принять', color: 'positive', payload: { req: { action: 'accept', code } } },
            { label: 'Отклонить', color: 'negative', payload: { req: { action: 'deny', code } } }
          ])
          .send();

        const tip = `\n💡 Вы можете отменить эту заявку, переслав это сообщение с текстом "отмена". (${code})`;
        return { code, tip };
      })
      .end();

    this.fileLoader.init(henta);
  }

  async start(henta) {
    const redisPlugin = henta.getPlugin('common/redis');
    this.requests = await redisPlugin.serializer.run({
      slug: 'req',
      defaultValue: new Set(),
      class: Set
    });
  }

  async processButton(ctx, payload) {
    const req = Array.from(this.requests).find(v => v.code === payload.code);
    if (!req || ctx.user.vkId !== req.vkId) {
      return;
    }

    return this.triggerAction(ctx, req, payload.action);
  }

  async triggerAction(ctx, req, action) {
    this.requests.delete(req);

    req.payload = req.payload || {};
    if (req.sourceId) {
      req.payload.source = await ctx.getPlugin('common/users').get(req.sourceId);
    }

    if (req.peers[0] !== ctx.peerId) {
      req.peers.push(ctx.peerId);
    }

    req.payload.peers = req.payload.peers || req.peers;

    req.payload.sendResult = async data => {
      ctx.answered = true;
      const botPlugin = ctx.getPlugin('common/bot');
      const messageBuilder = botPlugin.createBuilder(data, {
        henta: ctx.henta,
        vk: ctx.vk
      });

      return messageBuilder.send(req.payload.peers);
    };

    req.payload.sendBuilder = data => {
      const botPlugin = ctx.getPlugin('common/bot');
      const messageBuilder = botPlugin.createBuilder(data, {
        henta: ctx.henta,
        vk: ctx.vk
      });

      messageBuilder.answer = () => {
        ctx.answered = true;
        return messageBuilder.send(req.payload.peers);
      };

      return messageBuilder;
    };

    return this.tags[req.tag][action](ctx, req.payload);
  }

  async handler(ctx, next) {
    const payload = ctx.getPayloadValue('req');
    if (payload) {
      await this.processButton(ctx, payload);
      return next();
    }

    const reply = ctx.replyMessage;
    if (!reply || reply.senderId !== -ctx.henta.groupId) {
      return next();
    }

    if (!['+', '-', '1', '0', 'да', 'нет', 'отмена'].includes(ctx.text.toLowerCase())) {
      return next();
    }

    await this.processMessage(ctx, reply);
    return next();
  }


  async processMessage(ctx, reply) {
    const req = Array.from(this.requests).find(i => reply.text.includes(`(${i.code})`));
    if (!req) {
      return;
    }

    if (ctx.user.vkId === req.vkId) {
      return this.processSelf(ctx, req);
    } else if (req.sourceId && ctx.user.vkId === req.sourceId) {
      return this.processSource(ctx, req);
    }
  }

  async processSelf(ctx, req) {
    const action = ['+', '1', 'да'].includes(ctx.text.toLowerCase()) ? 'accept' : 'deny';
    return this.triggerAction(ctx, req, action);
  }

  processSource(ctx, req) {
    if (ctx.text.toLowerCase() !== 'отмена') {
      return;
    }

    this.requests.delete(req);
    ctx.answer('⭕ Вы отменили свою заявку.');
  }

  getFreeCode() {
    const symbols = '0123456789qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM';
    const getSymbol = () => symbols[Math.floor(Math.random() * symbols.length)];
    while (true) {
      const code = `${getSymbol()}${getSymbol()}`;
      if (!Array.from(this.requests).find(i => i.code === code)) {
        return code;
      }
    }
  }

  set(tag, handler) {
    if (this.tags[tag]) {
      this.henta.warning(`Тег ${tag} уже существует`);
    }

    this.tags[tag] = handler;
  }

  unset(tag) {
    delete this.tags[tag];
  }
}
