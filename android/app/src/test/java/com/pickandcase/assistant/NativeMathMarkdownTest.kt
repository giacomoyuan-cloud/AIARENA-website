package com.pickandcase.assistant

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeMathMarkdownTest {
    @Test fun equationsUseMarkwonDelimiters() {
        assertEquals("公式 \$\$a^2+b^2=c^2$$",NativeMathMarkdown.normalize("公式 \$a^2+b^2=c^2\$"))
        assertEquals("变量 \$\$x\$\$",NativeMathMarkdown.normalize("变量 \\(x\\)"))
        assertEquals("\n$$\nx^2\n$$\n",NativeMathMarkdown.normalize("\\[x^2\\]"))
    }
    @Test fun moneyCodeLinksAndDisplayMathStayIntact() {
        for(s in listOf("输入 \$4，输出 \$20", "\$20/\$100", "\$20/月，Max \$100/月", "`\$x\$`", "```js\nconst cost = '\$x\$';\n```", "https://example.com/\$x\$", "[\$x\$](https://example.com)", "$$\nx^2\n$$", "\\\$20"))assertEquals(s,NativeMathMarkdown.normalize(s))
    }
}
