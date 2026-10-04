import { EdgeMenuButton } from './EdgeMenuButton/EdgeMenuButton.js';
import { MyContext } from '../../src/index.js';

/**
 * @typedef {import('../../src/renderer.js').MenuItem} MenuItem
 */

/**
 * Пункты меню. Состав придуман для стенда: один пункт-владелец с подменю — чтобы
 * было видно, что снятие выделения касается только последнего открытого уровня, и
 * один отключённый — чтобы отличать «отметку сняли» от «пункт стал недоступен».
 *
 * @returns {Promise<MenuItem[]>}
 */
async function MenuItems()
{
    return [
        {
            labelAction: () => 'Открыть',
            action: () => {},
        },
        {
            labelAction: () => 'Вложенное',
            submenuAction: async () => {
                return [
                    { labelAction: () => 'Первый', action: () => {} },
                    { labelAction: () => 'Второй', action: () => {} },
                ];
            },
        },
        {
            labelAction: () => 'Выключено',
            isEnabledAction: () => false,
            action: () => {},
        },
    ];
}

/**
 * Меню стенда: тот же набор опций, что в стороннем проекте, — тёмная тема, один
 * показ на экземпляр, автоскрытие и увеличенный масштаб. Привязки нет ни здесь,
 * ни у вызывающего кода: показ идёт из обработчика кнопки.
 *
 * @returns {Promise<MyContext>}
 */
async function Create()
{
    return new MyContext(await MenuItems(), {
        theme: 'dark',
        label: 'Main menu',
        destroyOnClose: true,
        autoHideDistance: 50,
        scale: 1.2,
    });
}

/**
 * Показ по нажатию кнопки стенда.
 *
 * @param {string} id идентификатор кнопки.
 * @param {{ dismissible: boolean }} mode показ с глобальными правилами или без них.
 * @returns {void}
 */
function wire(id, mode)
{
    const button = document.getElementById(id);
    if (button === null) {
        throw new Error(`Стенд: нет кнопки #${id}`);
    }
    button.addEventListener('click', async (event) => {
        const menu = await Create();
        await menu.open(
            { x: event.clientX, y: event.clientY },
            mode.dismissible ? { dismissible: true } : undefined,
        );
    });
}

wire('bare', { dismissible: false });
wire('dismissible', { dismissible: true });

new EdgeMenuButton({
    host: document.getElementById('mainMenuButton'),
    onClick: async (event) => {
        const menu = await Create();
        await menu.open({ x: event.clientX, y: event.clientY });
    },
});