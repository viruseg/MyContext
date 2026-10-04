export class SvgHelper
{
    /**
     * Обёртка разметки иконки: `xmlns`, вьюпорт и обводка, одинаковые для всех иконок меню.
     *
     * @param {string} marks Содержимое иконки: элементы без обёртки `svg`.
     * @returns {string}
     */
    static Icon(marks)
    {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
            + '<g fill="none" stroke="currentColor" stroke-width="1.5"'
            + ' stroke-linecap="round" stroke-linejoin="round">'
            + marks
            + '</g></svg>';
    }
}