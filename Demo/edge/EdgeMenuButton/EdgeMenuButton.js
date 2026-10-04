import {SvgHelper} from "../SvgHelper.js";

const DEFAULT_REACH = 200;
const OPEN_CLASS = 'emb-open';
const PRESS_CLASS = 'emb-press';

/**
 * @typedef {{ left: number, top: number, right: number, bottom: number }} Rect Прямоугольник в координатах вьюпорта, границы включительно.
 */

export class EdgeMenuButton
{
    /** @type {HTMLElement | null} */
    #button = null;

    #host;
    #onClick;
    #label;
    #reach;

    /** @type {Rect | null} */
    #parked = null;

    #pointerX = 0;
    #pointerY = 0;

    /** @type {boolean} */
    #open = false;

    /** @type {boolean} */
    #primary = true;

    /** @type {AbortController | null} */
    #session = null;

    /**
     * @param {{ host?: HTMLElement, onClick: () => void, label?: string, reach?: number }} [deps]
     */
    constructor({host, onClick, label = 'Открыть меню', reach} = {})
    {
        if (typeof onClick !== 'function')
        {
            throw new TypeError('EdgeMenuButton: onClick должен быть функцией');
        }
        const parent = host ?? document.body;
        if (parent === null || !(parent instanceof HTMLElement))
        {
            throw new TypeError('EdgeMenuButton: host должен быть HTMLElement');
        }
        this.#host = parent;
        this.#onClick = onClick;
        this.#label = typeof label === 'string' && label !== '' ? label : 'Открыть меню';
        this.#reach = Number.isFinite(reach) && reach >= 0 ? reach : DEFAULT_REACH;
        this.#mount();
    }

    /**
     * @returns {boolean}
     */
    isOpen()
    {
        return this.#open;
    }

    destroy()
    {
        this.#session?.abort();
        this.#session = null;
        this.#button?.remove();
        this.#button = null;
        this.#parked = null;
        this.#open = false;
    }

    #mount()
    {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'emb-button';
        button.setAttribute('aria-label', this.#label);
        button.innerHTML = EdgeMenuButton.#MenuIcon();

        this.#host.appendChild(button);
        this.#button = button;
        this.#session = new AbortController();
        this.#connect(this.#session.signal);
        this.#measure();
    }

    #connect(signal)
    {
        this.#button.addEventListener(
            'click',
            (e) =>
            {
                this.#button.classList.remove(PRESS_CLASS);
                if (e.detail === 0 || this.#primary) this.#onClick(e);
            },
            {signal},
        );

        this.#button.addEventListener(
            'mousedown',
            (e) =>
            {
                this.#primary = e.button === 0;
                if (this.#primary) this.#button.classList.add(PRESS_CLASS);
                else e.preventDefault();
            },
            {signal},
        );

        this.#button.addEventListener('contextmenu', (e) => e.preventDefault(), {signal});

        window.addEventListener(
            'pointermove',
            (e) =>
            {
                this.#pointerX = e.clientX;
                this.#pointerY = e.clientY;
                this.#applyReach();
            },
            {signal, passive: true},
        );

        const release = () => this.#button?.classList.remove(PRESS_CLASS);
        window.addEventListener('pointerup', release, {signal});
        window.addEventListener('pointercancel', release, {signal});
        window.addEventListener('resize', () => this.#measure(), {signal});
    }

    #measure()
    {
        const button = this.#button;
        if (button === null) return;
        const width = button.offsetWidth;
        const top = Number.parseFloat(getComputedStyle(button).top) || 0;
        this.#parked = {left: -width, top, right: 0, bottom: top + button.offsetHeight};
        this.#applyReach();
    }

    #applyReach()
    {
        const parked = this.#parked;
        if (parked === null || this.#button === null) return;
        const dx = Math.max(parked.left - this.#pointerX, 0, this.#pointerX - parked.right);
        const dy = Math.max(parked.top - this.#pointerY, 0, this.#pointerY - parked.bottom);
        const near = dx <= this.#reach && dy <= this.#reach;
        if (near === this.#open) return;
        this.#open = near;
        this.#button.classList.toggle(OPEN_CLASS, near);
    }

    /**
     * Три равные полоски — классический знак меню.
     *
     * @returns {string} Разметка иконки для кнопки.
     */
    static #MenuIcon()
    {
        return SvgHelper.Icon(
            '<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>'
        );
    }
}
