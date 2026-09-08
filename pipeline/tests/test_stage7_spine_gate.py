from plato_pipeline.stage7_emit import SPINE_GRACE, spine_grace


def test_spine_grace_scales_down_for_the_smallest_works():
    # Flat, three misses let Clitophon pass at 0/2 and Menexenus at 7/10.
    assert spine_grace(2) == 0
    assert spine_grace(10) == 2
    assert spine_grace(12) == 3
    assert spine_grace(4234) == SPINE_GRACE
